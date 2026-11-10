---
name: avatar-voice
description: Transcribe audio, synthesize speech and generate ARKit lipsync viseme tracks for avatars with @three-ws/voice. Use when an agent needs ASR, TTS or a face animation from audio.
---

# Avatar voice with @three-ws/voice

Wraps the three.ws speech endpoints. The default lanes (NVIDIA Riva ASR, Magpie TTS, Audio2Face-3D) are free and need no key.

## Install

```
npm install @three-ws/voice
```

Node 18 or newer. Base URL defaults to `https://three.ws` (`baseUrl` option on `createVoice`).

## Functions

- `transcribe(audio, { format, language, sampleRate, words })`: `POST /api/asr`. `audio` is a Blob, ArrayBuffer or Uint8Array. `format` is `wav`, `pcm`, `flac` or `ogg` (WebM/Opus is rejected). Returns `{ text, confidence, language, words? }`.
- `speak(text, { voice, format, speed, model })`: `POST /api/tts/speak`. `format` is `mp3`, `wav`, `opus`, `aac`, `flac` or `pcm`. `model` is `tts-1`, `tts-1-hd` or `gpt-4o-mini-tts`. Returns `{ blob, contentType, voice, bytes }`.
- `lipsync(audio, { format: 'wav' | 'pcm', sampleRate })`: `POST /api/a2f`. Returns a `FaceTrack` with `fps`, `blendShapeNames` and `frames: [{ t, w: number[] }]` (ARKit blendshape weights, `t` in seconds).
- `say(text, { voice })`: synthesize and animate in one round trip. Returns `{ audio, animation }`.
- `voices()`: live catalog `{ default, voices: [{ id, name, description }] }`, `GET /api/tts/voices`.
- `asrInfo()` and `lipsyncInfo()`: probe whether each lane is configured.
- `createVoice({ baseUrl, fetch, apiKey, headers })`: reusable client.

## Example

```js
import { voices, speak, lipsync, transcribe, say } from '@three-ws/voice';

const catalog = await voices();
const clip = await speak('Hello from the avatar.', { voice: 'nova', format: 'wav' });
const face = await lipsync(clip.blob);
const heard = await transcribe(clip.blob, { format: 'wav' });
const both = await say('One round trip.', { voice: 'nova' });
console.log(face.frameCount, heard.text, both.animation.fps);
```

Drive an avatar by applying each frame's `w` weights to the morph targets named in `blendShapeNames`, timed from audio start. A runnable end to end script ships in `examples/voice-loop.mjs` (`node examples/voice-loop.mjs`).

Errors are `ThreeWsError` (`code`, `status`, `detail`, `retryAfter`). A 402 is `PaymentRequiredError`, which only appears on paid fallback lanes.
