---
name: avatar-voice
description: Give a 3D avatar a voice and a face with the audio-mcp tools: synthesize speech, transcribe audio, generate ARKit lipsync tracks, and fetch motion-capture clips. Use when an avatar must speak, when audio must become text, or when a lipsync or mocap track is needed.
---

# Avatar voice, lipsync and mocap

The plugin starts `@three-ws/audio-mcp` over stdio (`npx -y @three-ws/audio-mcp`). It calls the live three.ws API. The free NVIDIA lanes need no key.

## Environment

- `THREE_WS_API_KEY` (optional): a three.ws API key sent as a bearer token. It raises the metered TTS, ASR and Audio2Face limits and lets `motion_capture_clips` list your own private clips. Leave it unset to use the public surface anonymously.
- `THREE_WS_BASE` (optional): API origin, default `https://three.ws`.
- `THREE_WS_TIMEOUT_MS` (optional): per-request timeout, default 60000.

## Tools

| Tool | Key arguments | Endpoint |
| --- | --- | --- |
| `text_to_speech` | `text` (1-4096 chars), `voice`, `format`, `model`, `language`, `speed` | `POST /api/tts/speak` |
| `speech_to_text` | `audio` (base64), `format` (`wav`, `pcm`, `flac`, `ogg`), `language`, `sampleRate`, `words` | `POST /api/asr` |
| `audio_to_face` | `text` or `audio` (base64), `format` (`wav`, `pcm`), `sampleRate`, `voice`, `language` | `POST /api/a2f` |
| `motion_capture_clips` | `kind` (`face`, `pose`, `hand`, `vmc`), `include_public`, `limit` (1-100), `cursor` | `GET /api/mocap/clips` |
| `motion_capture_clip` | `id` (clip UUID) | `GET /api/mocap/clips/:id` |

Voices: `nova` (default), `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `onyx`, `sage`, `shimmer`, `verse`.

## Behavior to know

- `text_to_speech` returns `audio` as a `data:<mime>;base64,...` URL plus `voice`, `model`, `format`, `mime` and `sizeBytes`. The free NVIDIA lane serves every non-pcm request as WAV, so trust the returned `mime` and `format`, not the request.
- `audio_to_face` with `text` synthesizes the line and returns both `audio` and `animation`, so the lips match the audio you play. With `audio` it animates the bytes you supply. `animation` has `fps`, `blendShapeNames`, `frames` and `durationSec`. Each frame is `{ t, w }`, where `w` lists weights in `blendShapeNames` order (ARKit-52).
- `speech_to_text` caps audio at about 8 MB. Decode browser WebM recordings to WAV or PCM first. Pass `words: true` for per-word timestamps.
- `motion_capture_clips` returns metadata only. Fetch frames for one clip with `motion_capture_clip`. Anonymous callers see public clips only.

## Worked example

1. To make an avatar say a line with matching lips: call `audio_to_face` with `{"text": "Welcome back.", "voice": "nova"}`. Play `audio`, drive the face blendshapes from `animation.frames`.
2. To transcribe a user's recorded WAV: call `speech_to_text` with `{"audio": "<base64>", "format": "wav", "words": true}` and use `text`.
3. To find a recorded face clip: call `motion_capture_clips` with `{"kind": "face", "limit": 10}`, then `motion_capture_clip` with a returned `id`.

If a call returns an upstream error with a status, report the status and message. Do not retry in a loop.
