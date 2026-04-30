# Task: Voice cloning for agent personas (Phase 2)

## Context

The project is three.ws — a platform for 3D AI agents.

The repo is at `/workspaces/3D-Agent`.

**Background:**

Phase 2 of the three.ws roadmap is "Agent Personalization + Voice Cloning." The goal is that an agent has a consistent, unique voice — not the generic browser TTS voice, but a cloned voice that matches the agent's persona.

**Current voice stack:**

- `src/runtime/speech.js` — TTS providers:
  - `BrowserTTS` — Web Speech API, generic robot voice
  - `ElevenLabsTTS` — ElevenLabs streaming TTS, high quality but uses a shared/generic voice
  - `createTTS(config)` — factory function

- `src/element.js` — `<agent-3d>` web component. Has a `voice` attribute. Currently the voice provider is set once at element boot from manifest config.

- Agent manifest format (`agent-manifest/0.1`) — has a `voice` field in the manifest spec. Currently unused beyond provider selection.

- `api/agents/[id]/` — Agent CRUD API.

**The goal:** Allow each agent to have a cloned voice stored as part of its identity. The workflow:
1. **Recording:** User records 30–60 seconds of voice audio in the agent editor
2. **Cloning:** Audio is sent to ElevenLabs Voice Cloning API to create a custom voice
3. **Storage:** The resulting ElevenLabs `voice_id` is stored on the agent record
4. **Playback:** When the agent speaks, it uses its cloned voice via `ElevenLabsTTS`

---

## Architecture

### Database

Add `voice_id` and `voice_provider` columns to `agent_identities`:

```sql
ALTER TABLE agent_identities
  ADD COLUMN IF NOT EXISTS voice_provider text DEFAULT 'browser',
  ADD COLUMN IF NOT EXISTS voice_id text,
  ADD COLUMN IF NOT EXISTS voice_cloned_at timestamptz;
```

Add a migration file at `specs/schema/NNN-voice-cloning.sql`.

### Backend endpoints

**`POST /api/agents/:id/voice/clone`**

Accepts a multipart form upload with:
- `audio` — WAV or MP3 file (30–300 seconds, max 10MB)
- `name` — voice name (default: agent's name)
- `description` — optional

Flow:
1. Validate file size/type
2. Upload to ElevenLabs Voice Cloning API:
   ```
   POST https://api.elevenlabs.io/v1/voices/add
   xi-api-key: {ELEVENLABS_API_KEY}
   Content-Type: multipart/form-data
   Body: { name, description, files: [audioBlob] }
   ```
3. Store returned `voice_id` in `agent_identities`
4. Return `{ voice_id, name }`

Requires: agent ownership check. Rate limit: max 3 voice clones per user per day.

**`DELETE /api/agents/:id/voice`**

Removes the cloned voice:
1. Calls ElevenLabs `DELETE /v1/voices/{voice_id}` to free their quota
2. Clears `voice_id` and `voice_provider = 'browser'` on the agent record
3. Returns `204`

**`GET /api/agents/:id/voice`**

Returns `{ voice_provider, voice_id, voice_cloned_at }`. Used by the frontend to show current voice status.

### Frontend: Voice recording UI

Add a "Voice" section to the agent editor (`src/editor/` — check what files exist there). This UI needs:

1. A **Record** button that captures microphone audio via `MediaRecorder`
2. A timer showing recording duration (target: 30–60s, warn if too short)
3. A **Stop & Clone** button that uploads the recording
4. Status: "Cloning..." → "Voice cloned ✓" + a sample playback button
5. A **Remove voice** button (calls `DELETE /api/agents/:id/voice`)

Sample playback: after cloning, call:
```
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream
```
with a sample text like `"Hello, I'm your agent. How can I help you today?"` and play the audio.

### Runtime integration

In `src/runtime/index.js` or `src/element.js`, when loading the agent, check if the manifest or agent record has a `voice_id`. If so, initialize `ElevenLabsTTS` with that voice ID:

```js
const tts = createTTS({
  provider: agentData.voice_provider || 'browser',
  voiceId: agentData.voice_id,
  proxyURL: '/api/tts/elevenlabs',  // proxy to keep API key server-side
});
```

The TTS proxy endpoint at `POST /api/tts/elevenlabs` should already exist or needs to be created (it forwards to ElevenLabs with server-side key).

### Manifest field

Add `voice` to the agent manifest type:
```json
{
  "voice": {
    "provider": "elevenlabs",
    "voice_id": "abc123xyz"
  }
}
```

The manifest is served from `GET /api/agents/:id/manifest`. Include the voice field in the manifest response.

---

## Files to create/edit

**Create:**
- `api/agents/[id]/voice.js` — handles `GET`, `POST /clone`, `DELETE` (use method routing or separate files per project convention — check `api/agents/[id]/` for existing patterns)
- `specs/schema/NNN-voice-cloning.sql`
- Voice recording component in `src/editor/voice-recorder.js` (or `.jsx` if existing editor components use vhtml JSX)

**Edit:**
- `api/_lib/schema.sql` — add columns to `agent_identities`
- `src/runtime/index.js` or `src/element.js` — initialize TTS with cloned voice if available
- `api/agents/[id]/manifest.js` — include voice field in manifest response

**Do not touch:**
- `src/runtime/speech.js` — `ElevenLabsTTS` already supports arbitrary `voiceId`
- ElevenLabs TTS proxy if it already exists

---

## Environment variables

- `ELEVENLABS_API_KEY` — server-side only, never sent to client
- Already needed by existing ElevenLabs TTS features

---

## Acceptance criteria

1. Record 45 seconds of speech in the agent editor. Click "Clone Voice." The request processes and returns a `voice_id`.
2. Navigate to the agent's page. Have the agent speak. The voice matches the recording (noticeably different from the browser default voice).
3. Click "Remove voice." The agent reverts to browser TTS.
4. `GET /api/agents/:id/manifest` includes `voice.voice_id` when cloned.
5. Uploading a 3-second clip returns `400` with a clear error: `audio_too_short`.
6. Uploading a 50MB file returns `413`.
7. `npx vite build` passes. `node --check api/agents/[id]/voice.js` passes.

## Constraints

- `ELEVENLABS_API_KEY` must never be sent to the browser. All ElevenLabs API calls go through backend proxy endpoints.
- MediaRecorder records as `audio/webm;codecs=opus` in most browsers. ElevenLabs accepts MP3, WAV, M4A, WebM — WebM/Opus works directly.
- ESM in `src/`. API endpoints use `wrap(...)` pattern from `api/CLAUDE.md`.
- No new npm deps for the recording UI — use native `MediaRecorder` Web API.
- Rate limit voice cloning: max 3 per user per day (implement via `limits` helper or a manual counter).
