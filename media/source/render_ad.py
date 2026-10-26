"""Render Ownit's 30-second launch ad from the committed campaign artwork.

Requires Pillow, NumPy, and FFmpeg (on PATH, --ffmpeg, or imageio-ffmpeg).
Run from any directory: python media/source/render_ad.py
"""

import argparse
import math
import os
from pathlib import Path
import shutil
import subprocess
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "media"
W, H, FPS, DURATION = 1920, 1080, 24, 30
BG = (9, 14, 17)
WHITE = (240, 246, 244)
MUTED = (158, 180, 175)
MINT = (115, 244, 199)
FONT_DIR = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
FONTS = {}


def font(size, mono=False, bold=False):
    key = (size, mono, bold)
    if key not in FONTS:
        name = "consola.ttf" if mono else "segoeuib.ttf" if bold else "segoeui.ttf"
        path = FONT_DIR / name
        if not path.exists():
            path = Path("/usr/share/fonts/truetype/dejavu") / (
                "DejaVuSansMono.ttf" if mono else "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
            )
        FONTS[key] = ImageFont.truetype(str(path), size)
    return FONTS[key]


def text(draw, xy, value, size, color=WHITE, mono=False, bold=False):
    draw.text(xy, value, font=font(size, mono, bold), fill=color)


def artwork(name, shade):
    image = Image.open(ROOT / "docs" / "assets" / name).convert("RGB")
    image = image.resize((W, H), Image.Resampling.LANCZOS)
    return Image.blend(image, Image.new("RGB", (W, H), BG), shade)


def chrome(image, section):
    d = ImageDraw.Draw(image)
    d.rounded_rectangle((100, 70, 150, 120), 12, fill=MINT)
    text(d, (110, 71), ">", 32, BG, mono=True, bold=True)
    text(d, (168, 67), "ownit", 38, bold=True)
    text(d, (1430, 82), section, 22, MUTED)
    d.line((100, 982, 1820, 982), fill=(57, 80, 73), width=2)
    text(d, (100, 1000), "OWN THE CODE YOU SHIP.", 22, MINT, bold=True)
    text(d, (1430, 1000), "github.com/Yoosseph/ownit", 22, MUTED)


def terminal(d, y=330):
    d.rounded_rectangle((180, y, 1740, 900), 24, fill=(13, 22, 25), outline=(66, 94, 85), width=2)
    d.rounded_rectangle((180, y, 1740, y + 66), 24, fill=(26, 39, 42))
    d.rectangle((181, y + 35, 1739, y + 66), fill=(26, 39, 42))
    for i, color in enumerate([(237, 112, 114), (236, 199, 111), MINT]):
        d.ellipse((210 + i * 30, y + 24, 224 + i * 30, y + 38), fill=color)
    text(d, (780, y + 16), "~/shop  /  main", 24, MUTED, mono=True)


def typed(value, elapsed, rate=40):
    return value[: max(0, int(elapsed * rate))]


HERO = None
DETAIL = None


def frame(t):
    # Artwork remains unchanged on disk; these composites are video frames.
    image = (HERO if t < 8 or t >= 25 else DETAIL if t >= 20 else Image.new("RGB", (W, H), BG)).copy()
    d = ImageDraw.Draw(image)
    if t < 4:
        chrome(image, "01 / THE QUESTION")
        rise = int(22 * (1 - min(t / .7, 1)) ** 3)
        text(d, (100, 280 + rise), "You shipped the code.", 100, bold=True)
        text(d, (100, 420 + rise), "Can you explain it?", 100, MINT, bold=True)
        text(d, (106, 600), "Keep understanding in step with AI-assisted coding.", 36)
    elif t < 8:
        chrome(image, "02 / MEET OWNIT")
        text(d, (100, 260), "Own the code", 112, bold=True)
        text(d, (100, 398), "you ship.", 112, MINT, bold=True)
        text(d, (106, 598), "1–3 short questions about your change.", 40)
        text(d, (106, 662), "Right in your terminal.", 40)
        d.rounded_rectangle((106, 779, 654, 845), 18, fill=(26, 51, 43))
        text(d, (132, 792), "Powered by NVIDIA Nemotron", 28, MINT)
    elif t < 14:
        chrome(image, "03 / TERMINAL DEMO")
        text(d, (180, 178), "Start with why.", 76, bold=True)
        text(d, (180, 275), "Illustrative session · example answers", 24, MUTED)
        terminal(d)
        text(d, (225, 420), "$ git push", 34, MINT, mono=True)
        text(d, (225, 480), "Ownit (2 commits to octo/shop) Debrief now? [Y/n] y", 29, mono=True)
        text(d, (225, 559), "Question 1/2 (why)", 30, MINT, mono=True)
        text(d, (225, 615), "Why retry temporary payment failures?", 34, mono=True)
        answer = "So a temporary error doesn't lose the sale."
        text(d, (225, 695), "> " + typed(answer, t - 9.3, 27), 32, mono=True)
        if t > 12:
            text(d, (225, 784), "[OK] Passed.", 34, MINT, mono=True)
    elif t < 20:
        chrome(image, "04 / TERMINAL DEMO")
        text(d, (180, 178), "Explain how it works.", 76, bold=True)
        text(d, (180, 275), "Illustrative session · example answers", 24, MUTED)
        terminal(d)
        text(d, (225, 426), "Question 2/2 (how)", 30, MINT, mono=True)
        text(d, (225, 492), "When does the retry give up?", 34, mono=True)
        text(d, (225, 581), "> " + typed("After 3 tries. Permanent declines fail immediately.", t - 14.5, 30), 32, mono=True)
        if t > 17:
            text(d, (225, 677), "[OK] Passed.", 34, MINT, mono=True)
        if t > 18:
            d.rounded_rectangle((225, 757, 1675, 849), 14, fill=(25, 56, 45))
            text(d, (252, 780), "[OK] Push verified. 2 commits owned. Nice work.", 34, MINT, mono=True)
    elif t < 25:
        chrome(image, "05 / BUILD THE HABIT")
        text(d, (100, 218), "A small habit.", 94, bold=True)
        text(d, (100, 342), "A clearer understanding.", 94, MINT, bold=True)
        for x, title, sub in [(105, "WHY", "The purpose."), (710, "HOW", "The approach."), (1315, "NEXT", "The tradeoffs.")]:
            d.rounded_rectangle((x, 610, x + 490, 835), 20, fill=(13, 27, 28), outline=(64, 101, 86), width=2)
            text(d, (x + 32, 643), title, 48, MINT, bold=True)
            text(d, (x + 32, 723), sub, 32)
        text(d, (105, 887), "Debrief now, or come back with ownit interview.", 32)
    else:
        chrome(image, "06 / GET STARTED")
        text(d, (100, 234), "Own the code you ship.", 100, bold=True)
        text(d, (106, 388), "Make your next push a moment of understanding.", 37)
        d.rounded_rectangle((105, 522, 1340, 652), 18, fill=(16, 35, 32), outline=MINT, width=2)
        text(d, (144, 553), "$ npm i -g getownit", 52, MINT, mono=True)
        text(d, (106, 718), "Open source · GitHub · Node.js 20+", 32)
        text(d, (106, 782), "Bring a Nebius or NVIDIA API key. Setup in the README.", 28, MUTED)
        text(d, (106, 860), "github.com/Yoosseph/ownit", 36, MINT, bold=True)
    # Gentle fade at scene boundaries, without dropping readability during holds.
    starts = [0, 4, 8, 14, 20, 25]
    start = max(s for s in starts if s <= t)
    end = next((s for s in starts if s > t), DURATION)
    opacity = min(1, (t - start) / .28, (end - t) / .22)
    if opacity < 1:
        image = Image.blend(Image.new("RGB", (W, H), BG), image, max(0, opacity))
    ImageDraw.Draw(image).rectangle((0, H - 5, int(W * t / DURATION), H), fill=MINT)
    return image


def soundtrack(path):
    """Original, deterministic ambient score; no samples or licensed recordings."""
    rate = 48000
    t = np.arange(rate * DURATION, dtype=np.float64) / rate
    signal = np.zeros_like(t)
    # Airy A-minor / F / C / G harmony with a subtle rhythmic pulse.
    for start, notes in [(0, [220, 261.63, 329.63]), (8, [174.61, 220, 261.63]),
                         (16, [196, 261.63, 329.63]), (24, [196, 246.94, 293.66])]:
        local = t - start
        envelope = np.clip(local / 1.2, 0, 1) * np.clip((start + 8.5 - t) / 1.3, 0, 1)
        for freq in notes:
            signal += .035 * envelope * np.sin(2 * math.pi * freq * t + .3 * np.sin(t))
    for beat in np.arange(0, DURATION, .5):
        local = t - beat
        env = np.where((local >= 0) & (local < .4), np.exp(-np.maximum(local, 0) * 22), 0)
        signal += .095 * env * np.sin(2 * math.pi * 65 * local)
    for i, beat in enumerate(np.arange(0, DURATION, 1)):
        local = t - beat
        env = np.where((local >= 0) & (local < 1), np.exp(-np.maximum(local, 0) * 5), 0)
        signal += .025 * env * np.sin(2 * math.pi * [440, 523.25, 659.25, 783.99][i % 4] * local)
    signal *= np.minimum(t / 1.5, 1) * np.clip((DURATION - t) / 1.8, 0, 1)
    stereo = np.column_stack((signal, signal * .96))
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes((stereo * 32767).astype("<i2").tobytes())


def main():
    global HERO, DETAIL
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    parser.add_argument("--stills-only", action="store_true")
    args = parser.parse_args()
    HERO = artwork("ownit-hero.png", .65)
    DETAIL = artwork("ownit-understanding.png", .78)
    OUT.mkdir(exist_ok=True)
    previews = ROOT / ".tmp" / "ad-previews"
    previews.mkdir(parents=True, exist_ok=True)
    for t in [2, 6, 11.9, 18.7, 22.5, 27.5]:
        frame(t).save(previews / f"scene-{t:04.1f}.png")
    frame(6).save(OUT / "ownit-ad-poster.jpg", quality=94)
    frame(18.7).save(ROOT / "docs" / "assets" / "ownit-terminal-demo.png")
    if args.stills_only:
        return
    if not args.ffmpeg:
        import imageio_ffmpeg
        args.ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    audio = previews / "ownit-score.wav"
    soundtrack(audio)
    command = [args.ffmpeg, "-y", "-f", "rawvideo", "-vcodec", "rawvideo", "-pix_fmt", "rgb24",
               "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-i", str(audio),
               "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-b:a", "192k", "-t", str(DURATION), "-movflags", "+faststart",
               str(OUT / "ownit-ad-1080p.mp4")]
    # Write FFmpeg diagnostics to disk so a full stderr pipe cannot stall rendering.
    log_path = previews / "render.log"
    with log_path.open("wb") as log:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=log)
        try:
            for i in range(FPS * DURATION):
                process.stdin.write(frame(i / FPS).tobytes())
                if i % (FPS * 5) == 0:
                    print(f"Rendered {i // FPS}/{DURATION}s", flush=True)
        finally:
            process.stdin.close()
        result = process.wait()
    if result:
        raise RuntimeError(f"FFmpeg failed ({result}); see {log_path}")
    # Decode every frame and the audio stream to catch a corrupt/truncated export.
    subprocess.run([args.ffmpeg, "-v", "error", "-xerror", "-i",
                    str(OUT / "ownit-ad-1080p.mp4"), "-map", "0:v:0", "-map", "0:a:0",
                    "-f", "null", "-"], check=True)
    print("Validated full video and audio decode.", flush=True)
    print(f"Created {OUT / 'ownit-ad-1080p.mp4'}", flush=True)


if __name__ == "__main__":
    main()
