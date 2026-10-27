"""Render terminal-only Ownit examples and a narrated CLI demo."""

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
TMP = ROOT / ".tmp" / "ad-product"
W, H, FPS = 1920, 1080, 30
WHITE, MINT, MUTED = "#f0f5f3", "#8af3c8", "#8caaa1"
TIMELINE = json.loads((SOURCE / "timeline.json").read_text(encoding="utf-8"))
SCENES = TIMELINE["scenes"]
DURATION = TIMELINE["duration"]


def clamp(x):
    return max(0, min(1, x))


def ease(x):
    return 1 - (1 - clamp(x)) ** 4


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


BASE = Image.new("RGB", (W, H), "#0d1117")
DEMO = json.loads((SOURCE / "cli-demo.json").read_text(encoding="utf-8"))


def mono(im, value, x, y, size=29, color=WHITE):
    # Consolas lacks this glyph on some Windows systems; draw a real vector tick.
    if value.startswith("✓"):
        d = ImageDraw.Draw(im)
        d.line([(x+2, y+14), (x+9, y+21), (x+23, y+3)], fill=color, width=3)
        value = value[1:]
        x += font(size, "mono").getlength(" ")
    put(im, value, x, y, size, color, "mono")


def terminal_text(t):
    # Shell entry is staged; all debrief output below comes from the actual CLI.
    if t < 1.7:
        return "$ git show --stat --oneline HEAD\n7ac4e21 Retry temporary payment failures\n src/checkout.ts | 14 ++++++++++----\n\n$ "
    command = "git push"[:max(0, int((t - 1.70) * 18))]
    text = "$ " + command
    if t >= 3.0:
        text += "\nOwnit (1 commit to demo/shop) Debrief now? [Y/n] "
    if t >= 3.45:
        text += "y"
    for event in DEMO["events"]:
        if event["time"] <= t:
            text += event["text"]
    return text


def screen(t):
    im = BASE.copy()
    d = ImageDraw.Draw(im)
    # One persistent terminal window throughout the demo.
    d.rectangle((0, 0, W, 57), fill="#1a2029")
    for i, c in enumerate(["#ff6a65", "#eabb55", "#5acb81"]):
        d.ellipse((24+i*27, 21, 36+i*27, 33), fill=c)
    put(im, "shop — Ownit", W/2, 17, 22, "#d4dbe3", align="center")
    put(im, "CLI DEMO", W-32, 20, 15, "#8c9aa9", align="right")
    d.rectangle((0, H-32, W, H), fill="#182d27")
    put(im, "main     1 commit ready to push", 23, H-24, 17, "#a0b8af")
    put(im, "TypeScript     UTF-8", W-24, H-24, 17, "#a0b8af", align="right")
    terminal_y = 111
    d.rectangle((0, terminal_y, W, H-33), fill="#0c1218")
    d.line((0, terminal_y, W, terminal_y), fill="#344337", width=2)
    put(im, "TERMINAL", 35, terminal_y+20, 19, WHITE)
    d.line((35, terminal_y+48, 145, terminal_y+48), fill=MINT, width=2)
    put(im, "zsh  ·  ~/shop", W-40, terminal_y+20, 19, "#81968d", align="right")
    put(im, "checkout.ts", 30, 76, 19, "#81968d")
    put(im, "Ownit / push debrief", W-40, 76, 19, MINT, align="right")
    body_y = terminal_y + 82
    raw = terminal_text(t)
    lines = raw.split("\n")
    available = max(1, int((H-65-body_y) / 39))
    if t > 18.5:
        available = min(available, 15)
    lines = lines[-available:]
    for i, line in enumerate(lines):
        color = (MINT if line.startswith(("✓", "Question")) else
                 "#93a4b2" if line.startswith(("Nemotron", "Answer in", "Checking", "  Nice")) else WHITE)
        mono(im, line, 50, body_y + i*39, 28, color)
    if t < 12.4 and int(t*2) % 2 == 0 and lines:
        last = lines[-1]
        x = 50 + font(28, "mono").getlength(last)
        y = body_y + (len(lines)-1)*39
        d.rectangle((x+3, y, x+5, y+27), fill=MINT)
    # Keep the completed terminal on screen; the invitation joins its lower edge.
    cta = ease((t - 18.5) / .8)
    if cta:
        panel = Image.new("RGBA", (W, 158), (13, 30, 24, round(255*cta)))
        pd = ImageDraw.Draw(panel)
        pd.line((0, 0, W, 0), fill="#345847", width=2)
        put(panel, "Own the code you ship.", 50, 28, 43, WHITE, "bold", cta)
        put(panel, "$ npm i -g getownit", W-50, 33, 32, MINT, "mono", cta, "right")
        put(panel, "github.com/Yoosseph/ownit", 54, 100, 23, "#a8bdb4", alpha=cta)
        im.paste(panel, (0, H-190), panel)
    return im


def frame(t):
    return screen(t)


def example(title, subtitle, lines):
    """Readable, deterministic terminal artwork; commands are illustrative."""
    im = BASE.copy()
    d = ImageDraw.Draw(im)
    put(im, "OWNIT / TERMINAL GUIDE", 100, 65, 24, MINT, "mono")
    put(im, title, 100, 125, 64, WHITE, "bold")
    put(im, subtitle, 100, 220, 30, MUTED)
    d.rounded_rectangle((90, 305, W-90, 955), radius=18, fill="#0c1218", outline="#344337", width=2)
    put(im, "~/shop   —   illustrative session", 125, 330, 23, MUTED, "mono")
    d.line((90, 382, W-90, 382), fill="#344337", width=2)
    for i, line in enumerate(lines):
        mono(im, line, 130, 415+i*43, 29, MINT if line.startswith("$ ") else WHITE)
    put(im, "Own the code you ship.", 100, 995, 25, MUTED)
    return im


def readme_images():
    example("From setup to your first push.",
            "Install once. Connect your repo. Debrief right in your terminal.", [
        "$ npm i -g getownit", "$ ownit login",
        "$ ownit key set", "$ ownit init", "",
        "$ git push", "Ownit (1 commit to demo/shop) Debrief now? [Y/n] y", "",
        "Question 1/1 (why)", "  Why retry temporary payment failures?",
        "> So a temporary error doesn't lose the sale.",
        "✓ Push verified. 1 commit owned. Nice work.",
    ]).save(ROOT / "docs/assets/ownit-hero.png")
    example("Push now. Explain it later.",
            "Pending commits stay waiting until you finish their debrief.", [
        "$ git push", "Ownit (1 commit to demo/shop) Debrief now? [Y/n] n", "",
        "# Later, when you are ready:", "$ ownit interview", "",
        "# Pick a waiting push and answer in your own words.",
        "Question 1/1 (why)", "  Why retry temporary payment failures?",
        "> So a temporary error doesn't lose the sale.", "✓ Passed.",
        "✓ Push verified. 1 commit owned. Nice work.",
    ]).save(ROOT / "docs/assets/ownit-understanding.png")


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
    readme_images()
    for scene in SCENES:
        frame(scene["start"] + scene["duration"] - .7).save(TMP / (scene["id"] + ".png"))
    frame(15.0).save(OUT / "ownit-ad-poster.jpg", quality=95)
    frame(15.0).save(ROOT / "docs/assets/ownit-terminal-demo.png")
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
