# Task: Browser TTS with viseme timestamps (HeadTTS + Piper fallback)

## Context

Repo: `/workspaces/3D`. Task 09's TalkingHead adapter needs `{ audio, visemes, vtimes, vdurations }` to lipsync properly. We provide this via two cooperating paths:

- **HeadTTS (Kokoro, WebGPU/WASM)** — the primary browser path. Generates speech + phoneme timestamps; phonemes are mapped to Oculus visemes. Runs fully in-browser on modern devices.
- **[rhasspy/Piper](https://github.com/rhasspy/piper) (self-hosted server)** — the fallback for devices without WebGPU, or users who prefer a smaller client bundle.

Depends on task 09.

## Goal

1. A `TTS` module with a single API, `async synthesize(text, voice) -> { audio: AudioBuffer, visemes: string[], vtimes: number[], vdurations: number[] }`.
2. Automatic path selection: WebGPU-capable browsers use HeadTTS; others fall through to the Piper server (if configured) or to Web Speech API as a last resort (without visemes, best-effort jaw animation).
3. Streaming playback: audio starts playing as soon as the first chunk is ready, not after full synthesis.
4. TalkingHead consumes the output and lipsyncs correctly.

## Deliverable

1. **HeadTTS vendoring** — HeadTTS is part of the TalkingHead author's stack; vendor the browser build into `src/vendor/headtts/`. Include the Kokoro model or document its CDN URL.
2. **Piper client** `src/agent/tts-piper.js` — POSTs text to a configured `/api/tts` endpoint, receives `{ audioUrl, phonemes: [{ phoneme, startMs, endMs }] }`, maps phonemes to Oculus visemes.
3. **Piper server** under `services/piper/`:
   - Dockerfile (CPU-only, small image).
   - Serves `POST /api/tts` accepting `{ text, voice }` → returns audio + phoneme timestamps.
   - Pick one Piper voice model (e.g., `en_US-amy-medium`) as default; allow override via `voice` param.
4. **Unified facade** `src/agent/tts.js`:
   - `class TTS { constructor({ prefer: 'local'|'server'|'auto' }); async synthesize(text, voice?); dispose(); }`
   - Capability detection: WebGPU via `navigator.gpu`, WASM SIMD via a quick probe.
   - Route: `local` → HeadTTS; `server` → Piper; `auto` → HeadTTS if capable else Piper if `/api/tts` reachable else Web Speech API.
5. **Viseme mapping** `src/agent/viseme-map.js` — phoneme→Oculus viseme table. Oculus visemes: `sil, PP, FF, TH, DD, kk, CH, SS, nn, RR, aa, E, I, O, U`. Document gaps (not all phonemes map cleanly).
6. **TalkingHead wiring** — update task 09's `talking-head.js` adapter: `speak(text)` now internally calls `tts.synthesize` and passes the result to the engine. The raw `speak(text, { audio, visemes, ... })` overload stays for callers that synthesize externally.
7. **Audio playback** — use a shared `AudioContext`. Resume on first user interaction (browser autoplay policy). Document the gesture requirement in the reporting section.

## Audit checklist

- [ ] `npx vite build` passes; HeadTTS WASM/WebGPU assets lazy-load.
- [ ] On a WebGPU-capable browser: `await tts.synthesize('Hello world')` returns audio + ≥ 3 visemes with monotonically increasing times.
- [ ] Disable WebGPU → Piper server path works; returns equivalent shape.
- [ ] No Piper server + no WebGPU → Web Speech API path runs; visemes array is empty and TalkingHead shows an "approximate lipsync" mode.
- [ ] TalkingHead `speak('Hello world')` end-to-end produces recognizably lipsynced mouth movement.
- [ ] First audio byte plays within 300ms of `synthesize()` resolving (streaming, not "wait for full file").
- [ ] No audio plays without a prior user gesture; the first `speak()` before a gesture queues and plays on gesture.
- [ ] `node --check` new JS.

## Constraints

- Vendor HeadTTS; do not npm.
- Piper server is the only new backend in this task; it must scale to zero cost when unused (same deployment philosophy as task 08).
- Do not use OpenAI TTS, ElevenLabs, Azure, or any paid cloud TTS. Local + self-hosted only.
- Do not bundle Kokoro model weights into the main JS — lazy-load the model file.
- The Web Speech API fallback must not be the default — it's degrade-gracefully only.

## Verification

1. HeadTTS path on Chrome with WebGPU. Measure time-to-first-audio-byte and total-synthesis-time for a 20-word sentence.
2. Piper path via a locally running Docker container. Measure the same.
3. Reduced capabilities path (Safari with Web Speech) — lipsync visibly worse but not broken.
4. End-to-end: agent panel says "Tell me a joke" (fake it from console), TalkingHead speaks and lipsyncs.
5. Rapid-fire: call `speak()` 3 times quickly — previous utterance cancels, new one starts cleanly (no overlapping audio).

## Scope boundaries — do NOT do these

- No voice cloning.
- No multi-speaker conversation.
- No real-time TTS (mid-utterance token streaming). Chunk-streaming is fine, but we're not aiming at duplex real-time.
- No TTS caching by text content (yet) — each request synthesizes fresh. Caching is a future optimization.
- Do not add telemetry on what users ask the avatar to say.

## Reporting

- HeadTTS commit SHA vendored + Kokoro model URL.
- Time-to-first-audio and total-synthesis-time for a reference sentence on both paths.
- The phoneme→viseme table, with any phonemes that don't have a clean mapping noted.
- Piper Docker image size.
- Known quality issues (sibilance, plosives, long vowels) and whether they suggest a different engine long-term.
