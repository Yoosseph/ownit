"""Render the narrated Ownit launch film offline from its committed edit timeline."""

import argparse
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import textwrap
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "media"
SOURCE = OUT / "source"
TMP = ROOT / ".tmp" / "ad-v2"
W, H, FPS = 1920, 1080, 30
WHITE, MINT, MUTED = "#f0f5f3", "#8af3c8", "#8caaa1"
TIMELINE = json.loads((SOURCE / "timeline.json").read_text(encoding="utf-8"))
SCENES = TIMELINE["scenes"]
DURATION = TIMELINE["duration"]


def clamp(x):
    return max(0, min(1, x))


def ease(x):
    return 1 - (1 - clamp(x)) ** 4


def smooth(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


@lru_cache(maxsize=64)
def font(size, style="regular"):
    names = {"regular": "segoeui.ttf", "bold": "segoeuib.ttf", "light": "segoeuil.ttf", "mono": "consola.ttf"}
    path = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / names[style]
    if not path.exists():
        path = Path("/usr/share/fonts/truetype/dejavu") / (
            "DejaVuSansMono.ttf" if style == "mono" else "DejaVuSans-Bold.ttf" if style == "bold" else "DejaVuSans.ttf")
    return ImageFont.truetype(str(path), size)


@lru_cache(maxsize=512)
def glyph(value, size, color, style):
    f = font(size, style)
    box = f.getbbox(value)
    im = Image.new("RGBA", (max(1, box[2] - box[0] + 4), max(1, box[3] - box[1] + 4)))
    ImageDraw.Draw(im).text((2 - box[0], 2 - box[1]), value, font=f, fill=color)
    return im


def put(image, value, x, y, size=40, color=WHITE, style="regular", alpha=1, align="left"):
    sprite = glyph(value, size, color, style)
    if align == "center":
        x -= sprite.width / 2
    elif align == "right":
        x -= sprite.width
    if alpha < 1:
        sprite = sprite.copy()
        sprite.putalpha(sprite.getchannel("A").point(lambda p: int(p * clamp(alpha))))
    image.paste(sprite, (round(x), round(y)), sprite)


def reveal(image, value, x, y, size, elapsed, delay=0, color=WHITE, style="regular", align="left"):
    p = ease((elapsed - delay) / .85)
    put(image, value, x, y + (1 - p) * 34, size, color, style, p, align)


BASE = Image.new("RGB", (W, H), (9, 13, 12))
PHOTOS = {name: Image.open(ROOT / "docs/assets" / filename).convert("RGB") for name, filename in {
    "hero": "ownit-hero.png", "team": "ownit-understanding.png", "work": "ownit-workspace.png"
}.items()}
shade = np.tile(np.linspace(175, 18, W, dtype=np.uint8), (H, 1))
PHOTO_MASK = Image.fromarray(shade)


def mark(im, x=110, y=72, size=38):
    layer = Image.new("RGBA", (size * 5, size + 12))
    d = ImageDraw.Draw(layer)
    d.line([(3, 5), (size * .35, size * .42), (3, size * .8)], fill=MINT, width=3)
    d.line([(size * .48, size * .8), (size * .83, size * .8)], fill=MINT, width=3)
    put(layer, "ownit", size + 4, 0, size, WHITE, "bold")
    im.paste(layer, (int(x), int(y)), layer)


def photo_background(scene, t):
    key = {"hook": "hero", "brand": "hero", "push": "work", "questions": "team",
           "answer": "work", "later": "hero", "close": "team"}[scene["id"]]
    original = PHOTOS[key]
    p = clamp((t - scene["start"]) / scene["duration"])
    # Slow camera moves over photographic stills. Original PNGs stay untouched.
    zoom = 1.015 + .045 * p
    crop_w = original.width / zoom
    crop_h = crop_w * H / W
    x = (original.width - crop_w) * (.35 + .2 * p)
    y = (original.height - crop_h) * .45
    im = original.resize((W, H), Image.Resampling.BICUBIC, box=(x, y, x + crop_w, y + crop_h))
    im = Image.composite(BASE, im, PHOTO_MASK)
    mark(im)
    return im


def panel(width, height):
    im = Image.new("RGBA", (width, height))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, width - 1, height - 1), 24, fill="#0e191a", outline="#304c42", width=2)
    d.line((1, 66, width - 2, 66), fill="#253b34", width=1)
    for i, c in enumerate(["#55746b", "#6f8c81", "#8af3c8"]):
        d.ellipse((28 + i * 24, 28, 37 + i * 24, 37), fill=c)
    put(im, "~/shop", width - 34, 25, 20, MUTED, "mono", align="right")
    return im


def float_panel(im, card, x, y, p):
    scale = .97 + .03 * ease(p)
    card = card.resize((round(card.width * scale), round(card.height * scale)), Image.Resampling.BICUBIC)
    im.paste(card, (round(x + (1 - scale) * card.width / 2), round(y + 35 * (1 - ease(p)))), card)


def check(d, x, y, p):
    points = [(x, y), (x + 11, y + 11), (x + 32, y - 15)]
    if p < .3:
        q = p / .3
        points = [points[0], (x + 11 * q, y + 11 * q)]
    else:
        q = clamp((p - .3) / .7)
        points[2] = (x + 11 + 21 * q, y + 11 - 26 * q)
    d.line(points, fill=MINT, width=3)


def scene_image(scene, t):
    u, sid = t - scene["start"], scene["id"]
    im = photo_background(scene, t)
    d = ImageDraw.Draw(im)
    if sid == "hook":
        phase = smooth((u - 2.35) / .45)
        intro = ease(u / .85) * (1 - phase)
        put(im, "Code moves", 135, 340 - 20 * phase, 91, WHITE, "bold", intro)
        put(im, "fast.", 135, 455 - 20 * phase, 106, WHITE, "bold", intro)
        reveal(im, "Can you", 135, 340, 96, u, 2.5, WHITE, "bold")
        reveal(im, "explain it?", 135, 458, 96, u, 2.62, MINT, "bold")
        reveal(im, "Understand the code you ship.", 141, 620, 30, u, 3.15, WHITE)
    elif sid == "brand":
        reveal(im, "Meet", 142, 300, 33, u, .05, WHITE)
        reveal(im, "ownit", 130, 390, 165, u, .18, WHITE, "bold")
        reveal(im, "Own the code you ship.", 142, 618, 36, u, .65, MINT)
    elif sid == "push":
        reveal(im, "Your next push.", 140, 212, 80, u, .05, style="bold")
        reveal(im, "A short debrief, right in your terminal.", 145, 332, 31, u, .25, WHITE)
        card = panel(1010, 322)
        put(card, "$", 48, 116, 57, MINT, "mono")
        command = "git push"[:int(max(0, u - .25) * 12)]
        put(card, command, 102, 116, 57, WHITE, "mono")
        if u < 1.4:
            cx = 102 + font(57, "mono").getlength(command) + 5
            ImageDraw.Draw(card).rectangle((cx, 118, cx + 3, 173), fill=MINT)
        prompt = "Ownit   Debrief now? [Y/n]"
        reveal(card, prompt, 48, 236, 32, u, 1.1, MUTED, "mono")
        reveal(card, "y", 66 + font(32, "mono").getlength(prompt), 236, 32, u, 2.6, MINT, "mono")
        float_panel(im, card, 140, 460, u / 1.4)
    elif sid == "questions":
        reveal(im, "A little clarity.", 135, 215, 72, u, .1, style="bold")
        reveal(im, "One to three short questions.", 140, 320, 29, u, .3, WHITE)
        labels = [("Why", "The purpose.", 1.85), ("How", "The approach.", 3.33), ("Next", "The tradeoffs.", 4.50)]
        for i, (title, sub, activation) in enumerate(labels):
            yy = 430 + i * 156
            p = ease((u - activation) / .7)
            reveal(im, title, 140, yy, 68, u, .5 + i * .13, MINT if p > .4 else "#c0cbc5", "light")
            reveal(im, sub, 335, yy + 28, 27, u, activation, WHITE)
            d.line((140, yy + 105, 140 + max(1, 420 * p), yy + 105), fill=MINT, width=2)
    elif sid == "answer":
        reveal(im, "Your words.", 140, 185, 76, u, .1, style="bold")
        reveal(im, "Your understanding.", 145, 291, 46, u, .3, MINT, "light")
        card = panel(920, 510)
        put(card, "WHY", 42, 112, 22, MINT, "mono")
        put(card, "Why retry temporary", 42, 162, 35)
        put(card, "payment failures?", 42, 209, 35)
        answer = "So a temporary error\ndoesn't lose the sale."
        count = int(max(0, u - .8) * 30)
        for i, line in enumerate(answer[:count].split("\n")):
            put(card, ("> " if i == 0 else "  ") + line, 42, 289 + i * 42, 30, WHITE, "mono")
        if u > 3.2:
            cd = ImageDraw.Draw(card)
            cd.line((42, 400, 876, 400), fill="#294139", width=1)
            check(cd, 48, 450, ease((u - 3.2) / .6))
            reveal(card, "Push verified.", 102, 432, 31, u, 3.35, MINT)
        float_panel(im, card, 140, 390, u / 1.1)
        reveal(im, "Illustrative session", 1060, 935, 21, u, .7, WHITE, align="right")
    elif sid == "later":
        reveal(im, "On your", 135, 300, 91, u, .1, style="bold")
        reveal(im, "schedule.", 135, 415, 91, u, .22, style="bold")
        reveal(im, "Debrief now. Or pick it up later.", 142, 568, 30, u, .45, WHITE)
        p = ease((u - .7) / .85)
        pill = Image.new("RGBA", (750, 116))
        ImageDraw.Draw(pill).rounded_rectangle((1, 1, 748, 114), 18, fill="#102720", outline="#507b63", width=2)
        put(pill, "$ ownit interview", 375, 36, 39, MINT, "mono", align="center")
        if p < 1:
            pill.putalpha(pill.getchannel("A").point(lambda a: round(a * p)))
        im.paste(pill, (140, round(675 + (1 - p) * 35)), pill)
    else:
        reveal(im, "Own the code", 135, 280, 90, u, .05, WHITE, "bold")
        reveal(im, "you ship.", 135, 405, 108, u, .22, MINT, "bold")
        reveal(im, "$ npm i -g getownit", 145, 620, 35, u, .8, WHITE, "mono")
        reveal(im, "github.com/Yoosseph/ownit", 145, 724, 27, u, 1.1, WHITE)
        reveal(im, "Open source  /  Setup in the README", 145, 890, 22, u, 1.45, WHITE)
    return im


def frame(t):
    index = max(i for i, s in enumerate(SCENES) if s["start"] <= t)
    image = scene_image(SCENES[index], t)
    if index and t - SCENES[index]["start"] < .45:
        mix = smooth((t - SCENES[index]["start"]) / .45)
        image = Image.blend(scene_image(SCENES[index - 1], t), image, mix)
    if t < .25:
        image = Image.blend(BASE, image, smooth(t / .25))
    if t > DURATION - .5:
        image = Image.blend(image, BASE, smooth((t - DURATION + .5) / .5))
    return image


def audio_mix(ffmpeg):
    """Keep the voice prominently above an original, softly ducked ambient score."""
    rate, count = 48000, round(DURATION * 48000)
    decoded = subprocess.run([ffmpeg, "-v", "error", "-i", str(SOURCE / "narration.mp3"),
        "-ar", str(rate), "-ac", "1", "-f", "f32le", "-"], capture_output=True, check=True)
    voice = np.frombuffer(decoded.stdout, dtype="<f4")
    voice = np.pad(voice, (0, max(0, count - len(voice))))[:count]
    time = np.arange(count, dtype=np.float64) / rate
    music = np.zeros((count, 2), dtype=np.float64)
    chords = [(130.81, 164.81, 196, 246.94), (110, 130.81, 164.81, 196),
              (87.31, 130.81, 174.61, 220), (98, 146.83, 196, 246.94)]
    for n, start in enumerate(np.arange(0, DURATION, 8)):
        local = time - start
        env = np.clip(local / 2, 0, 1) * np.clip((10 - local) / 2, 0, 1)
        for freq in chords[n % len(chords)]:
            for channel in range(2):
                phase = 2 * math.pi * freq * time + channel * .19 + .04 * np.sin(time * .6)
                music[:, channel] += .012 * env * (np.sin(phase) + .12 * np.sin(phase * 2))
    for i, beat in enumerate(np.arange(1, DURATION, 1.5)):
        local = np.maximum(time - beat, 0)
        env = np.where(time >= beat, (1 - np.exp(-local * 80)) * np.exp(-local * 2.8), 0)
        note = [523.25, 659.25, 783.99, 987.77, 783.99, 659.25][i % 6]
        pluck = .013 * env * (np.sin(2 * math.pi * note * local) + .09 * np.sin(2 * math.pi * note * 2 * local))
        music[:, i % 2] += pluck
        music[:, (i + 1) % 2] += .55 * pluck
    block = 4800
    rms = np.array([np.sqrt(np.mean(voice[i:i + block] ** 2)) for i in range(0, count, block)])
    envelope = np.interp(np.arange(count), np.arange(len(rms)) * block, rms)
    music *= (1 - .65 * np.clip(envelope / .035, 0, 1))[:, None]
    music *= (np.minimum(time / 2, 1) * np.clip((DURATION - time) / 1.6, 0, 1))[:, None]
    mix = music + voice[:, None]
    peak = float(np.max(np.abs(mix)))
    if peak > .93:
        mix *= .93 / peak
    target = TMP / "mix.wav"
    with wave.open(str(target), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes((np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes())
    return target


def srt_time(seconds):
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def captions():
    cues = []
    for scene in SCENES:
        words, tokens = scene["words"], scene["speech"].split()
        if len(tokens) != len(words):
            raise ValueError("Narration words and script differ; regenerate timeline")
        start = 0
        for i, token in enumerate(tokens):
            if token.endswith((".", "?")) or i == len(tokens) - 1:
                phrase = textwrap.fill(" ".join(tokens[start:i + 1]).replace("Own it", "Ownit"), width=42)
                end = words[i]['end'] + .1
                if i + 1 < len(words):
                    end = min(end, words[i + 1]['start'])
                cues.append(f"{len(cues) + 1}\n{srt_time(words[start]['start'])} --> {srt_time(end)}\n{phrase}\n")
                start = i + 1
    (OUT / "ownit-ad.srt").write_text("\n".join(cues), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    parser.add_argument("--stills-only", action="store_true")
    args = parser.parse_args()
    TMP.mkdir(parents=True, exist_ok=True)
    captions()
    for scene in SCENES:
        frame(scene["start"] + scene["duration"] - .7).save(TMP / (scene["id"] + ".png"))
    frame(SCENES[-1]["start"] + 3).save(OUT / "ownit-ad-poster.jpg", quality=95)
    frame(next(s["start"] for s in SCENES if s["id"] == "answer") + 4.6).save(ROOT / "docs/assets/ownit-terminal-demo.png")
    if args.stills_only:
        return
    if not args.ffmpeg:
        import imageio_ffmpeg
        args.ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    mix = audio_mix(args.ffmpeg)
    destination = OUT / "ownit-ad-1080p.mp4"
    command = [args.ffmpeg, "-v", "warning", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-i", str(mix),
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-af", "loudnorm=I=-16:TP=-1:LRA=9", "-ar", "48000", "-c:a", "aac", "-b:a", "256k",
        "-t", str(DURATION), "-movflags", "+faststart", str(destination)]
    with (TMP / "render.log").open("wb") as log:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=log)
        try:
            for i in range(round(FPS * DURATION)):
                process.stdin.write(frame(i / FPS).tobytes())
                if i % (FPS * 5) == 0:
                    print(f"Rendered {i / FPS:.0f}/{DURATION}s", flush=True)
        finally:
            process.stdin.close()
        if process.wait():
            raise RuntimeError(f"FFmpeg failed: see {TMP / 'render.log'}")
    subprocess.run([args.ffmpeg, "-v", "error", "-xerror", "-i", str(destination),
                    "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], check=True)
    print(f"Created and fully decoded {destination} ({DURATION}s, {FPS} fps)", flush=True)


if __name__ == "__main__":
    main()
