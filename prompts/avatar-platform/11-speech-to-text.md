# Task: In-browser STT with whisper-web

## Context

Repo: `/workspaces/3D`. The current agent panel ([src/agent-panel.js](../../src/agent-panel.js) after task 01) uses the Web Speech API for voice input, which is Chrome/Edge-only and sends audio to Google. We replace it with [xenova/whisper-web](https://github.com/xenova/whisper-web) (MIT), which runs OpenAI's Whisper model in the browser via Transformers.js.

Depends on task 01 (renamed agent panel exists).

## Goal

1. Browser-native STT that works in Chrome, Edge, **and Safari/Firefox** (no Google dependency).
2. Audio never leaves the device.
3. Mic button on the agent panel triggers whisper-web; transcription shows up inline as the user speaks (streaming partials) and finalizes on silence or button release.
4. Fallback to Web Speech API if the device can't run whisper-web (very old / very low memory).

## Deliverable

1. **Vendor or npm** — whisper-web depends on `@xenova/transformers`. Install via npm (it's infrastructural-ish, and bundling Transformers.js manually is painful).
2. **New module** `src/agent/stt.js`:
   - `class STT { async start({ onPartial, onFinal, onError }); stop(); dispose(); }`
   - Loads the whisper `base.en` model (or `tiny.en` on low-memory devices) lazily on first `start()`.
   - Uses `MediaRecorder` + a VAD-ish silence detector to chunk audio into ~1s windows for streaming transcription.
   - Supports cancel mid-utterance.
3. **Capability detection** — `STT.canUseLocal()` returns true if:
   - `navigator.hardwareConcurrency >= 4`.
   - `navigator.deviceMemory >= 4` (fallback to `true` on Safari where this API is absent — treat as capable).
   - WebAssembly SIMD probe passes.
4. **Agent panel integration** — in `src/agent-panel.js`, replace the Web Speech API block with STT:
   - Mic button press → `stt.start(...)`.
   - Partial results render in the input field in a muted color.
   - Final result commits to the input; auto-sends if "push-to-talk" mode is active (new option).
   - Release or press-again → `stt.stop()`.
5. **Fallback wiring** — if `STT.canUseLocal()` is false, dynamically import the old Web Speech path and route through it with the same event shape.
6. **Model hosting** — prefer the Hugging Face CDN by default; allow override with `VITE_WHISPER_MODEL_URL` for self-hosted deploys.

## Audit checklist

- [ ] Whisper model loads once per session, cached by the browser.
- [ ] On Chrome, Edge, Firefox, Safari: mic → transcription works.
- [ ] No audio leaves the device (verify via Network tab — after model load, zero audio-bearing requests).
- [ ] Pressing the mic button a second time mid-utterance cancels cleanly; no dangling MediaRecorder streams.
- [ ] Accuracy on a standard test phrase ("The quick brown fox...") within reasonable bounds of whisper-base.en's known performance.
- [ ] Reduced-motion doesn't affect STT but the "listening" pulse animation respects it.
- [ ] Accessibility: `aria-live` updates as partial results arrive.
- [ ] `node --check` new files.

## Constraints

- No cloud STT. Whisper runs locally; fallback is Web Speech (which hits Google but is already what we had).
- Model size: `base.en` is ~150 MB; load progress UI must show download on first run.
- Do not share the `AudioContext` with TTS (task 10) — mic capture uses its own context, deliberately separate to avoid feedback.
- Do not transcribe audio captured by the photo-capture flow (task 04/06). That's video-only; STT is unrelated.
- Do not log transcribed text to a server. The agent (task 14) uses it locally.

## Verification

1. First run on a fresh browser profile → model download progress UI shows → transcription works after load.
2. Subsequent runs → instant start.
3. Non-English utterance → whisper-base.en transcribes English-approximation; flag this in the reporting (a future task could upgrade to multilingual `base`).
4. Offline (airplane mode after first load) → still works, since model is cached.
5. Compare accuracy on three test phrases with the old Web Speech path — document delta.

## Scope boundaries — do NOT do these

- No speaker diarization.
- No wake-word / "hey avatar" trigger — require button press.
- No always-on listening.
- No translation.
- No push-to-server for "cloud whisper" — local only.

## Reporting

- Whisper model chosen + its size + load time on first visit.
- Accuracy comparison vs Web Speech on the test phrases.
- Any device classes that fall through to the fallback and why.
- Memory footprint while transcribing (heap + Transformers internal).
- Known issues (accents, background noise, very short utterances) and whether they're deal-breakers.
