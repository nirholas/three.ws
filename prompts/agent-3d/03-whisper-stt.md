# Task 03 — Whisper STT provider

## Context

Browser-native `SpeechRecognition` (`BrowserSTT` in [src/runtime/speech.js](../../src/runtime/speech.js)) is unreliable: Chromium-only on desktop, varying quality, cloud-dependent anyway. Whisper via the OpenAI API (or a self-hosted whisper.cpp endpoint) produces consistent transcriptions across browsers and languages.

The factory `createSTT({ provider })` throws for anything other than `"browser"` or `"none"`.

## Goal

Add `WhisperSTT` to [src/runtime/speech.js](../../src/runtime/speech.js) that records mic audio, sends it to a Whisper endpoint, and returns transcripts — with the same `listen({ onInterim, onFinal })` surface as the browser variant.

## Deliverable

1. **`WhisperSTT` class** in [src/runtime/speech.js](../../src/runtime/speech.js):
	 - Constructor: `{ endpoint, apiKey, language = "en", model = "whisper-1", chunkDurationMs = 3000 }`.
		 - `endpoint` defaults to `https://api.openai.com/v1/audio/transcriptions`. Operators can point to their own whisper.cpp server by swapping.
	 - `async listen({ onInterim, onFinal })`:
		 - Request mic permission via `navigator.mediaDevices.getUserMedia({ audio: true })`.
		 - Record with `MediaRecorder` (`audio/webm;codecs=opus`).
		 - Option A (simpler): stop recording on VAD silence (see below) or when `stop()` is called, upload the full blob, emit one `onFinal(text)`.
		 - Option B (preferred): chunk recording every `chunkDurationMs`, upload each chunk, emit `onInterim(text)` per chunk, emit `onFinal(text)` on stop. Chunks are independent transcriptions; concatenate on the client.
		 - Emit VAD-based silence detection using `AudioContext` + `AnalyserNode` RMS threshold — stop recording after ~1.2s of silence unless in `continuous` mode.
	 - `stop()` — halt recording, await any in-flight transcription, resolve the `listen()` promise with accumulated text.
	 - `listening` getter.
2. **Register in `createSTT()`**.
3. **Update [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md)** — add `whisper` to the `voice.stt.provider` enum, document `endpoint` and `language` fields.

## Audit checklist

- [ ] Mic permission is requested exactly once per session; revoked permission raises a typed error.
- [ ] Transcription works in Chrome, Firefox, Safari (16+) — all support `MediaRecorder` with Opus.
- [ ] VAD silence detection does not cut off the user mid-sentence (test with a 4-second pause in the middle of speaking).
- [ ] `onInterim` fires incrementally in chunked mode; `onFinal` fires exactly once on stop.
- [ ] Uploaded blobs are ≤ 25 MB (Whisper API limit) — chunk if longer.
- [ ] Works behind a proxy: if `endpoint` is a relative path or non-OpenAI origin, do not send `Authorization` unless `apiKey` is explicitly passed.
- [ ] Cleanup on `stop()`: all `MediaStreamTrack`s are stopped, `AudioContext` closed, pending fetches aborted.
- [ ] Browser shows the mic indicator only while actively recording.

## Constraints

- No new npm dependencies.
- Do not introduce WebSocket streaming (OpenAI's realtime API is a future task).
- Do not block on missing `MediaRecorder` — raise a typed error so the runtime can fall back.
- Do not persist audio blobs — hold them in memory for the duration of the upload, then release.

## Verification

1. `node --check src/runtime/speech.js`.
2. `npm run build:lib` passes.
3. Manual test in three browsers: speak a few sentences, confirm accurate transcription; stop mid-sentence, confirm clean abort.
4. DevTools Memory: after 10 `listen()` sessions, no MediaRecorder or AudioContext leaks.

## Scope boundaries — do NOT do these

- Do not add lipsync / phoneme timing output.
- Do not add language detection or translation — pass-through the `language` param.
- Do not attempt offline Whisper (WASM whisper.cpp) — that's a separate task.
- Do not change the runtime's `Runtime.listen()` method.

## Reporting

- Which mode (A or B) you implemented and why.
- VAD silence threshold chosen (RMS value + window size) and how it felt.
- Transcription latency observed (speech end → final text).
- Any browser-specific quirks (Safari's MediaRecorder issues are known).
