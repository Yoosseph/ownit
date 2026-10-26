# Ownit launch campaign

[Watch the 30-second ad](ownit-ad-1080p.mp4) · [Poster](ownit-ad-poster.jpg) · [Captions](ownit-ad.srt)

![Ownit ad poster](ownit-ad-poster.jpg)

The launch ad targets developers using coding agents. Its message is the project's existing
tagline: **Own the code you ship.** It is a finished motion graphic with animated terminal
answers, scene fades, on-screen copy, and an original synthesized instrumental soundtrack.
There is no voiceover. The video is 1920 × 1080, 16:9, 24 fps, H.264 with AAC stereo audio.
The MP4 is optimized for playback before a full download (`faststart`).

The terminal sequence is an illustrative, shortened session based on the project's payment
retry example. It is labeled in the video; it is not a recording of a live model response.
Passing a debrief means the answers passed Ownit's grading. It does not prove authorship or
code correctness. The ad makes no security, productivity, or performance guarantees.

| Time | Visual / message |
| --- | --- |
| 0–4s | Hook: “You shipped the code. Can you explain it?” |
| 4–8s | Introduce Ownit and the short terminal debrief. |
| 8–14s | Illustrative `git push`, question about why, typed answer. |
| 14–20s | Question about how, typed answer, verified push. |
| 20–25s | Why / how / next; option to return with `ownit interview`. |
| 25–30s | Install command, repository URL, prerequisites. |

## Artwork

The two campaign illustrations were generated with the built-in image generation tool.
Their complete prompts are preserved in [source/image-prompts.json](source/image-prompts.json).
Original generated PNGs live in [../docs/assets/](../docs/assets/). They are conceptual
artwork, not product screenshots. The terminal still is rendered from the ad's source.
The soundtrack is synthesized by the renderer; it uses no external recordings or samples.

## Re-render

Use Python 3.10+ and install [source/requirements.txt](source/requirements.txt) into your
preferred virtual environment, then run:

```sh
python -m pip install -r media/source/requirements.txt
python media/source/render_ad.py
```

If FFmpeg is already installed, pass `--ffmpeg /path/to/ffmpeg` to use it. Otherwise
the renderer uses the binary bundled with `imageio-ffmpeg`. Fonts are Segoe UI and
Consolas on Windows, with DejaVu fallbacks on Linux; different fonts can change layout.
`--stills-only` renders the poster and preview stills without encoding video.
Intermediate frames, audio, and logs go into the ignored `.tmp/` directory.

The SRT contains accessibility descriptions of the scene messages. Primary marketing copy
and terminal text are already visible in the video. Keep the SRT alongside the video when
uploading to a platform with caption support.

Suggested post copy:

> You shipped the code. Can you explain it? Ownit asks 1–3 short questions about your
> change, right in your terminal. Debrief now or come back later. Own the code you ship.
> https://github.com/Yoosseph/ownit
