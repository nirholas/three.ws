# Talking-avatar clips ("Make a clip")

One click turns an avatar and a line of text, or an uploaded recording, into a
shareable MP4 of that avatar saying it. The voice is NVIDIA Magpie (Riva TTS),
the face is NVIDIA Audio2Face-3D, and the video is rendered frame by frame in
the viewer's browser.

Where it lives:

| Surface | Entry point |
|---|---|
| Agent and avatar pages (`/agents/:id`, `/avatars/:id`) | "Make a clip" in the action row ([src/avatar-page.js](../src/avatar-page.js)) |
| Avatar Studio (`/avatar-studio`) | "Make a clip" in the header; exports the look on screen, unsaved edits included ([src/avatar-studio.js](../src/avatar-studio.js)) |

## Pipeline

```
text ──► POST /api/clips/voice ──► NVIDIA Magpie (WAV, 44.1 kHz)
                                 └► NVIDIA Audio2Face-3D (30 fps ARKit-52 track)
recording ─(browser: decode, 16 kHz mono s16)─► POST /api/clips/voice ──► Audio2Face-3D

browser: GLB + track + audio ──► offline frame-stepped three.js render
                              ──► WebCodecs encode (H.264 / HEVC / VP9 / AV1 video, AAC / Opus audio)
                              ──► mediabunny MP4 mux (fast start) ──► preview, download, share
```

| File | Role |
|---|---|
| [api/clips/voice.js](../api/clips/voice.js) | Voice and face for one clip. Enforces quota and duration before any NVIDIA call. |
| [api/_lib/clip-policy.js](../api/_lib/clip-policy.js) | Per-plan daily clip count and maximum clip length. |
| [src/clip/clip-math.js](../src/clip/clip-math.js) | Pure frame timing, audio placement, captions, framing and lag math (unit tested). |
| [src/clip/clip-renderer.js](../src/clip/clip-renderer.js) | Offline render, encode and mux. |
| [src/clip/clip-dialog.js](../src/clip/clip-dialog.js) | The dialog: options, progress, preview, download, share, and every error state. |
| [scripts/verify-clip-export.mjs](../scripts/verify-clip-export.mjs) | Real-browser export of both aspects plus an ffmpeg lip-sync measurement. |

### Why offline rendering

Clips are not screen captures. Frame `i` is drawn for presentation time
`i / 30` s regardless of how long it took to draw, so a slow laptop produces
the same file as a fast one, with no dropped frames and no drift.

### Sync model

- Every clip starts with a 0.3 s lead-in and ends with a 0.6 s tail.
- The speech audio is placed in the output track starting at exactly the
  lead-in (`audioOffsetSamples`).
- Frame `i` poses the face from the Audio2Face-3D track at speech time
  `i / 30 - 0.3` (`speechTimeForFrame`), interpolated between track frames.
- So any instant of speech lands in the same video frame as its audio sample.
  `tests/clip-math.test.js` asserts this for 16, 44.1 and 48 kHz.

`scripts/verify-clip-export.mjs` measures the exported file itself: the MP4's
audio against the Magpie WAV (expected 9 frames, the lead-in), and the mouth
region's darkness in the decoded frames against the Audio2Face-3D `jawOpen`
channel (expected 0 frames). It passes only when both are within one frame.

## Options

| Option | Values |
|---|---|
| Format | Portrait 1080x1920 (9:16), Landscape 1920x1080 (16:9) |
| Framing | Close-up, Head and shoulders, Full body |
| Background | Studio scene (sky gradient, ground shadow), solid colour (includes chroma green `#00b140` for keying), or an uploaded image (cover-fit) |
| Captions | Burned in, timed across the voiced span of the audio (text lines only) |
| Mark | Small "three.ws" mark, top right, on by default |
| Voice | Any Magpie voice in [api/_lib/tts-voices.js](../api/_lib/tts-voices.js) |

After a clip finishes, "Also make Landscape/Portrait" re-renders the same line
in the other format from the cached voice and face track: no second quota hit.

Avatars without ARKit, VRM or viseme blendshapes fall back to driving a jaw
bone from `jawOpen`; the result view says so. An avatar with neither gets a
clear note instead of a silent, motionless face.

## Limits

Enforced server side in `/api/clips/voice` before NVIDIA is called:

| Plan | Clips per day | Max length |
|---|---|---|
| Visitor (not signed in, per IP) | 3 | 20 s |
| Free | 10 | 30 s |
| Pro | 60 | 60 s |
| Team | 200 | 60 s |
| Enterprise | 1000 | 60 s |

- Text over the plan's character budget (18 characters per second) is rejected
  before quota is spent; the measured Magpie duration is checked again after
  synthesis. Recordings are measured before quota is spent.
- Quota lives in the `clip:user:<plan>` and `clip:ip` rate-limit buckets
  (fail closed). A spent allowance returns `429` with `code: "clip_quota"` and
  `quota.resetAt`.
- `GET /api/clips/voice` returns the caller's plan, allowance, voices and
  whether the server is configured, without spending anything.

## Browser support

Clips need WebCodecs (`VideoEncoder` and `AudioEncoder`). Measured on
2026-11-16 with `scripts/verify-clip-export.mjs` and an encoder probe:
Chromium 158 on Linux encodes H.264, VP9, AV1 and Opus (no AAC, no HEVC), so a
Linux Chrome clip is H.264 + Opus in MP4. Chrome and Edge (94+), Firefox (130+)
and Safari 26 ship both encoders. Browsers without them get a clear message
naming what is missing and which browsers work, before any quota is spent.
There is no server render path: WebCodecs covers every current desktop and
Android browser, and a headless-Chromium render on Cloud Run would spend GPU
time to serve a shrinking set of old browsers.

## API

`POST /api/clips/voice`

```json
{ "text": "Hello from three.ws.", "voice": "nova" }
```
or
```json
{ "audio": "<base64 16 kHz mono s16 PCM>", "sampleRate": 16000 }
```

Success:

```json
{
  "ok": true,
  "audio": { "base64": "...", "contentType": "audio/wav", "sampleRateHz": 44100, "voiceName": "...", "durationSec": 3.2 },
  "animation": { "fps": 30, "blendShapeNames": ["jawOpen", "..."], "frames": [{ "t": 0, "w": [0.1, "..."] }], "durationSec": 3.2 },
  "quota": { "plan": "free", "perDay": 10, "remaining": 9, "resetAt": "2026-11-17T00:00:00.000Z" }
}
```

Errors carry `error` (`too_long`, `too_short`, `bad_request`, `rate_limited`,
`not_configured`, `timeout`, `provider_error`), a readable `error_description`,
`stage` (`voice` or `face`) for NVIDIA failures, and `quota` once a clip has
been charged.

## Verifying

```bash
# API with the NVIDIA key from Secret Manager in process env only
PORT=3268 NVIDIA_API_KEY="$(node scripts/read-service-env.mjs '^NVIDIA_API_KEY$' --raw)" \
  node --env-file=.env.local server/index.mjs
DEV_API_PROXY=http://localhost:3268 npm run dev -- --port 3267 --strictPort
node scripts/verify-clip-export.mjs --out /path/to/proof
npx vitest run tests/clip-math.test.js tests/clip-policy.test.js tests/clip-voice-api.test.js
```
