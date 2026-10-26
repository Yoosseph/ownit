# Ownit launch film

[Watch the narrated ad](ownit-ad-1080p.mp4) · [Poster](ownit-ad-poster.jpg) · [Captions](ownit-ad.srt) · [Voiceover](source/narration.mp3)

![Own the code you ship](ownit-ad-poster.jpg)

A 37.4-second film for developers using coding agents, built around **Own the code you ship**.
The edit follows a warm male neural narrator, with photorealistic scenes of developers,
their laptops, and handwritten notes. Slow camera moves, restrained typography, animated
terminal interactions, and overlapping transitions accompany a quiet original ambient score.
The music drops underneath spoken words. The closing card holds long enough to read the
installation command and repository address.

The export is 1920 × 1080, 16:9, 30 fps, H.264 with AAC stereo audio and `faststart`.
The final mix targets -16 LUFS with a -1 dBTP ceiling. Captions follow the spoken words.

## Story

| Time | Picture and narration |
| --- | --- |
| 0–6.0s | A developer at her laptop; “AI helps you ship faster. But can you explain the code you just pushed?” |
| 6.0–9.2s | Brand reveal; “Meet Ownit.” |
| 9.2–14.0s | Animated `git push` and debrief prompt; “A short debrief, right in your terminal.” |
| 14.0–22.4s | Two colleagues discussing their work; why, how, and next follow the narrator. |
| 22.4–28.2s | Hands sketching in a notebook, with an illustrative debrief; “Answer in your own words…” |
| 28.2–32.2s | `ownit interview`; “Busy now? Come back later.” |
| 32.2–37.4s | Installation command, repository address, and closing tagline. |

The terminal content is an illustrative, shortened session based on the project's payment
retry example. A verified push means its debrief passed grading; it does not prove authorship
or code correctness.

## Voice and assets

The voiceover is AI-generated using Microsoft Edge's `en-US-AndrewNeural` voice at `-8%`
rate and `-2Hz` pitch, through [edge-tts](https://github.com/rany2/edge-tts).
The script spells the product name “Own it” for pronunciation. Captions display “Ownit.”
No person's voice was cloned.

- [story.json](source/story.json): narration script and minimum scene durations.
- [narration.mp3](source/narration.mp3): the finished voice track, included for offline rendering.
- [timeline.json](source/timeline.json): scene boundaries and word timings from synthesis.
- [render_ad.py](source/render_ad.py): motion design, music synthesis, mix, captions, poster, and export.
- [generate_narration.py](source/generate_narration.py): optional voice regeneration.

Three photographic-style images were generated with the built-in image generation tool:

- [Developer at a laptop](../docs/assets/ownit-hero.png)
- [Two colleagues discussing their work](../docs/assets/ownit-understanding.png)
- [Hands, notebook, and laptop](../docs/assets/ownit-workspace.png)

These are AI-generated fictional people and settings, not photographs of actual Ownit users
or customer endorsements. The film animates the stills with slow pans and zooms; it is not
live-action footage. The complete prompts and reference roles are preserved in
[image-prompts.json](source/image-prompts.json). The terminal overlay and typography are drawn
by the renderer; the README terminal still comes from this cut. The score contains no external
recordings or samples.

## Re-render offline

Use Python 3.10+:

```sh
python -m pip install -r media/source/requirements.txt
python media/source/render_ad.py
```

The renderer uses the committed voice track and timeline, so it makes no network requests.
Pass `--ffmpeg /path/to/ffmpeg` to use your own encoder; otherwise it uses `imageio-ffmpeg`.
Segoe UI and Consolas are used on Windows, with DejaVu fallbacks on Linux.
Font substitutions can change line widths. `--stills-only` exports the poster, terminal still,
captions, and scene previews without encoding video. Intermediate files go into ignored `.tmp/`.
Every completed export is decoded in full to check both the video and audio streams.

## Change the narration

Edit `source/story.json`, then run:

```sh
python -m pip install -r media/source/requirements-voice.txt
python media/source/generate_narration.py
python media/source/render_ad.py
```

Voice generation requires network access and sends the public narration script to the speech
service. It writes a new voice track and timeline. If you change the script or delivery rate,
review the visual timing in the renderer and the resulting captions before publishing.

Suggested post copy:

> AI helps you ship faster. Can you explain the code you just pushed? Ownit asks one to three
> short questions about your change, right in your terminal. Own the code you ship.
> https://github.com/Yoosseph/ownit
