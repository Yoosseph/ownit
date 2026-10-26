"""Generate the campaign's neural voiceover and a word-aligned edit timeline.

Requires edge-tts and FFmpeg. Sends only the public campaign script to Edge TTS.
The committed audio/timeline allow later video renders to run completely offline.
"""

import asyncio
import json
from pathlib import Path
import subprocess
import wave

import edge_tts
import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "media" / "source"
TMP = ROOT / ".tmp" / "narration"
RATE = 48000


async def main():
    TMP.mkdir(parents=True, exist_ok=True)
    story = json.loads((SOURCE / "story.json").read_text(encoding="utf-8"))
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    scenes, chunks, cursor = [], [], 0.0
    for scene in story["scenes"]:
        path = TMP / (scene["id"] + ".mp3")
        words = []
        communicate = edge_tts.Communicate(scene["speech"], voice=story["voice"],
                                          rate=story["rate"], pitch=story["pitch"],
                                          boundary="WordBoundary")
        with path.open("wb") as audio:
            async for part in communicate.stream():
                if part["type"] == "audio":
                    audio.write(part["data"])
                elif part["type"] == "WordBoundary":
                    words.append({"text": part["text"], "start": part["offset"] / 1e7,
                                  "end": (part["offset"] + part["duration"]) / 1e7})
        decoded = subprocess.run([ffmpeg, "-v", "error", "-i", str(path), "-f", "f32le",
                                  "-ar", str(RATE), "-ac", "1", "-"], capture_output=True, check=True)
        samples = np.frombuffer(decoded.stdout, dtype="<f4")
        if not len(samples) or not words:
            raise RuntimeError(f"Missing audio/timing for {scene['id']}")
        # Explicit breathing room; never speed up the narrator to fit a slide.
        lead = .28 if cursor else .45
        duration = max(scene["minimum_seconds"], lead + len(samples) / RATE + .35)
        duration = np.ceil(duration * 30) / 30
        segment = np.zeros(round(duration * RATE), dtype=np.float32)
        offset = round(lead * RATE)
        segment[offset:offset + len(samples)] = samples
        chunks.append(segment)
        scenes.append({**scene, "start": round(cursor, 6), "duration": float(duration),
                       "words": [{**w, "start": round(w["start"] + cursor + lead, 6),
                                  "end": round(w["end"] + cursor + lead, 6)} for w in words]})
        print(f"{scene['id']}: {duration:.2f}s ({len(words)} words)", flush=True)
        cursor += duration
    signal = np.concatenate(chunks)
    wav_path = TMP / "narration.wav"
    with wave.open(str(wav_path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes((np.clip(signal, -1, 1) * 32767).astype("<i2").tobytes())
    subprocess.run([ffmpeg, "-v", "error", "-y", "-i", str(wav_path),
                    "-af", "highpass=f=75,loudnorm=I=-17:TP=-2:LRA=7", "-c:a", "libmp3lame",
                    "-b:a", "192k", str(SOURCE / "narration.mp3")], check=True)
    (SOURCE / "timeline.json").write_text(json.dumps({"voice": story["voice"], "rate": story["rate"],
        "pitch": story["pitch"], "duration": round(cursor, 6), "scenes": scenes}, indent=2) + "\n", encoding="utf-8")
    print(f"Narration ready: {cursor:.2f}s", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
