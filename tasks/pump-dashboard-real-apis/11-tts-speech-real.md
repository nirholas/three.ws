# 11 — Animations page: wire Speech input to real TTS

## Problem
[pump-dashboard.html](../../pump-dashboard.html) `agentAction('speak')` (lines ~1086–1091) builds an `{ type: 'speak', text }` action and posts it via `iframe.contentWindow.postMessage(...)` to `/agent-embed.html?id=<agentId>`. There is no proof that the embed handles `speak` with a real TTS path — and even if it does, it isn't wired here in a verifiable way. The Speech control may silently no-op. The form is shipped to a production page so it must produce real audible output backed by a real TTS API.

## Outcome
Typing into the Speech field and clicking **Speak** plays real audio (the agent's voice) and triggers the agent's lip-sync, every time. On error (rate limit, missing API key, etc.) the user sees the real upstream error.

## Endpoints (already exist)
- ElevenLabs proxy: [api/tts/eleven.js](../../api/tts/eleven.js) (consumes `ELEVENLABS_API_KEY` server-side and streams audio).
- The agent embed: [agent-embed.html](../../agent-embed.html) — verify it listens for `agent:action` `speak` and renders both audio + lip-sync.

## Implementation
1. Open [agent-embed.html](../../agent-embed.html) and confirm the `speak` action handler:
   - POSTs `{ text, voice_id }` to `/api/tts/eleven` (or returns the audio URL via streaming).
   - Plays the returned audio with `<audio>` and drives the avatar's viseme/lip-sync from it.
   If any of that is missing or stubbed (`throw 'not implemented'`, `setTimeout` fake speech, browser `speechSynthesis` fallback, etc.), implement it for real. Use the same agent's stored `voice_id` (read from `agent_identities.meta.voice_id` via `GET /api/agents/:id`); if no voice id is set, surface the real error "agent has no voice configured" — do not fall back to a default voice silently.
2. In [pump-dashboard.html](../../pump-dashboard.html):
   - On Speak click: validate `text` is non-empty, then post the `agent:action` message exactly as today, **but also** set up a one-time `window.addEventListener('message', …)` listener for the iframe's reply (`agent:action:result` with `{ ok, error? }`) and toast the real error if `ok === false`. No silent failures.
   - Add a real "Stop" button that posts `{ type: 'speak:stop' }` to the iframe; the embed must support that and stop playback.
3. Disable the Speak button while audio is playing; re-enable on `agent:action:result` or on the audio `ended` event reported back from the iframe. No `setTimeout` re-enable.

## Definition of done
- Type "hello world" + Speak → real audio plays through speakers, sourced from `/api/tts/eleven`. Verify in DevTools network tab.
- Lip-sync visibly moves on the avatar in the iframe.
- With `ELEVENLABS_API_KEY` removed from `.env`, click Speak → real upstream 503/missing-config error surfaces in a toast; nothing silently succeeds.
- The Stop button cuts audio mid-utterance.
- No use of `window.speechSynthesis` anywhere (browser TTS is not the platform's voice).
- `npm test` green; **completionist** subagent run on changed files.
