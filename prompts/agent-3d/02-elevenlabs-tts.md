# Task 02 — ElevenLabs TTS provider

## Context

TTS is currently browser-only (`BrowserTTS` in [src/runtime/speech.js](../../src/runtime/speech.js)) — good for ubiquity, bad for character. An agent with a distinct, crafted voice needs higher-quality synthesis. ElevenLabs is the common choice for real-time voice synthesis with recognizable timbre and low latency.

The factory `createTTS({ provider })` dispatches on `provider` and currently throws for anything other than `"browser"` or `"none"`.

## Goal

Add `ElevenLabsTTS` to [src/runtime/speech.js](../../src/runtime/speech.js) that ships a proxy-friendly, streaming-audio-aware implementation behind the same `speak(text)` / `cancel()` / `speaking` interface, so switching providers is a manifest field.

## Deliverable

1. **`ElevenLabsTTS` class** in [src/runtime/speech.js](../../src/runtime/speech.js):
	 - Constructor: `{ voiceId, modelId = "eleven_turbo_v2_5", apiKey, proxyURL, rate = 1, pitch = 1, lang = "en-US" }`.
	 - `async speak(text, { onStart, onEnd })` — POST to ElevenLabs `text-to-speech/{voiceId}/stream` endpoint (via `proxyURL` if set, else direct with `apiKey`). Stream the audio response via `MediaSource` or fall back to buffered `<audio>` playback if the browser doesn't support MSE for `audio/mpeg`.
	 - `cancel()` aborts the fetch and stops playback. Set `this._speaking = false`.
	 - Respect `rate` and `pitch` by mapping to ElevenLabs' `voice_settings` (`stability`, `similarity_boost`, `style`, `use_speaker_boost`) where reasonable. Document mapping choice in a code comment.
	 - Same public surface as `BrowserTTS`: `speak`, `cancel`, `speaking` getter.
2. **Register in `createTTS()`** — dispatch `provider === "elevenlabs"`.
3. **Update [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md)** — extend the `voice.tts.provider` enum to include `"elevenlabs"` with a note about `voiceId` and `modelId` fields.
4. **Update [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md)** — document that `tts="elevenlabs:{voiceId}"` on the element is shorthand. Parser lives in [src/element.js](../../src/element.js).

## Audit checklist

- [ ] Streaming playback starts within ~500ms on a fast connection — first audio chunk plays before the full response is received.
- [ ] `cancel()` interrupts mid-utterance immediately; the next `speak()` begins cleanly.
- [ ] `speaking` transitions true → false only when audio fully ends (or is canceled).
- [ ] `onStart` fires on first audible frame, `onEnd` on final frame or abort.
- [ ] Fallback to buffered playback works in Safari for `audio/mpeg` (MediaSource limitations).
- [ ] No API key appears in DevTools Network tab when `proxyURL` is used.
- [ ] Works with the runtime's voice event dispatch — `voice:speech-start` / `voice:speech-end` fire correctly.
- [ ] `prefers-reduced-motion: reduce` does NOT affect TTS (it's motion-only) — do not gate on it.

## Constraints

- No new npm dependencies. Use `fetch` + `MediaSource` + `AudioContext` as needed.
- Do not introduce Web Audio graph routing, EQ, or per-word timing — keep to play/stop.
- Browser-side only; the proxy is outside this task's scope (but document its expected request/response shape).
- Do not touch [src/runtime/index.js](../../src/runtime/index.js).

## Verification

1. `node --check src/runtime/speech.js`.
2. `npm run build:lib` passes.
3. Manual: configure an agent with `voice.tts.provider = "elevenlabs"` and a test voice id; confirm audible speech and cancel behavior in Chrome + Safari + Firefox.
4. Network panel: confirm no raw api key when `proxyURL` is configured.

## Scope boundaries — do NOT do these

- Do not add voice cloning, voice selection UI, or custom pronunciation dictionaries.
- Do not attempt to sync mouth shapes / visemes to phonemes — that's a separate task (lipsync).
- Do not wire an ElevenLabs agent (their "conversational AI" product) — we're using TTS only.
- Do not add billing/quota tracking.

## Reporting

- Note the chosen `voice_settings` mapping for `rate`/`pitch` and whether it felt natural.
- Report startup latency observed (first byte → first audible frame).
- Document the proxy request shape you assumed (for the follow-up backend task).
- Flag any browser where streaming audio did not work and what fallback kicked in.
