# Task 04 — Voice picker (TTS)

## Why

Agents speak in `protocol.emit('speak', { text })`. Today they use the browser's default Web Speech API voice — every agent sounds identical on the same device. Let the owner pick.

## Read first

- [src/runtime/speech.js](../../src/runtime/speech.js) — TTS abstraction
- [src/agent-protocol.js](../../src/agent-protocol.js) — `speak` event wiring
- [src/agent-avatar.js](../../src/agent-avatar.js) — speech triggers mouth morphs
- ElevenLabs API docs — `/v1/text-to-speech/:voice_id` streaming

## Build this

### 1. Persona extension

From task 01: `persona.voiceProvider` (`web` | `eleven`), `persona.voiceId`.

### 2. Web Speech path

- Enumerate voices via `window.speechSynthesis.getVoices()`.
- Group by lang/gender.
- Store voice selection by **name** not index (indices shift across browsers). On playback, re-find by name; fall back to default if missing.

### 3. ElevenLabs path (optional, behind env flag)

- Server proxy `POST /api/tts/eleven` (auth required) — accepts `{ voiceId, text }`, forwards to ElevenLabs with the server's `ELEVENLABS_API_KEY`.
- Streams audio back (`text/event-stream` or `audio/mpeg` chunked).
- Client plays it via `new Audio(objectURL)`.
- Rate limit 1000 chars / user / hour.
- Cache synthesized clips by `sha256(voiceId + text)` → R2 for 30 days; serve from cache on repeat.
- Voice list via `/api/tts/eleven/voices`.

### 4. `/agent/:id/edit` tab "Voice"

- Provider toggle: `web` / `elevenlabs` (gated if API key not present).
- Voice list with "Preview" button — speaks a hardcoded sentence: "Hi, I'm your agent."
- Save → persona patch.

### 5. Runtime hook

`src/runtime/speech.js#speak(text)`:
- Read `identity.persona.voiceProvider + voiceId`.
- If `web`, synthesize locally.
- If `eleven`, call `/api/tts/eleven`.
- Emit visemes to `agent-avatar.js` (if speech API supports boundary events) so mouth morphs sync.

### 6. Fallback chain

If ElevenLabs fails (network, rate limit, missing key), fall back to Web Speech silently. Log a console warning, surface the failure on the audit timeline.

## Don't do this

- Do not expose `ELEVENLABS_API_KEY` client-side. Server proxy only.
- Do not auto-speak all messages — respect `kiosk` and a per-agent `speakOnLoad` flag (default off).
- Do not clone the user's voice (would require consent flow we're not building).

## Acceptance

- [ ] Pick a Web Speech voice → preview works, persona saves.
- [ ] If `ELEVENLABS_API_KEY` env set, user can pick from the ElevenLabs list; preview streams.
- [ ] Missing key → ElevenLabs option is disabled with a "not configured" tooltip.
- [ ] Rate limit triggers on spam (1 MB of text) → clear message.
- [ ] `npm run build` passes.

## Reporting

- Screenshot of the voice tab
- Server logs showing a synthesized + cached call
- A short audio sample (link) from each provider
