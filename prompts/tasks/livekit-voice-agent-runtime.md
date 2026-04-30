# Task: Wire LiveKit realtime voice into the agent runtime

## Context

The project is three.ws — a platform for 3D AI agents.

The repo is at `/workspaces/3D-Agent`.

**What exists today:**

- `experiments/livekit-voice/` — An upstream clone of `livekit-examples/agent-starter-react`. A production-grade realtime voice agent built on LiveKit. Has a React frontend + a Python/Node agent server. It handles VAD (voice activity detection), STT (Whisper), LLM (GPT-4), and TTS in a continuous pipeline. We're interested in the LiveKit client SDK pattern, not running the experiment's server.

- `src/runtime/speech.js` — Current STT: `BrowserSTT` (uses `window.SpeechRecognition`). Current TTS: `BrowserTTS` or `ElevenLabsTTS`. Both are one-shot — the user clicks "listen", the agent speaks, then stops.

- `src/runtime/index.js` — The LLM brain loop. Calls `speech.speak(text)` and `speech.listen()` separately. No continuous conversation.

- `src/agent-protocol.js` — Event bus. Relevant events: `speak { text, sentiment }`, `listen-start {}`, `listen-end { text }`.

- `src/element.js` — The `<agent-3d>` web component. Has `voice` attribute (undocumented). The runtime is initialized here.

**The problem:** Voice interaction today is click-to-talk, one turn at a time. There's no continuous voice conversation where the user and agent take turns naturally. LiveKit enables low-latency bidirectional audio with server-side VAD and agent-side TTS — but nothing wires it to this project's agent runtime.

**The goal:** Add a `LiveKitVoice` class to `src/runtime/speech.js` that connects to a LiveKit room, streams microphone audio to a LiveKit agent server, and plays back agent TTS audio — integrating with the existing protocol bus (emit `speak` when agent talks, `listen-start`/`listen-end` when user talks).

---

## Architecture

### LiveKit room model

LiveKit uses a room abstraction. The 3D agent page joins a room as a "participant". A server-side LiveKit agent joins the same room and handles the voice pipeline. The agent server emits data messages to signal when it's speaking and what text it said, so the frontend can:
1. Drive avatar animations when agent speaks
2. Show transcripts

### What this task builds

A `LiveKitVoice` class in `src/runtime/speech.js`:

```js
export class LiveKitVoice {
  constructor({ serverUrl, token, protocol }) { ... }
  async connect() { ... }        // join the room, set up tracks
  async disconnect() { ... }     // leave cleanly
  get connected() { ... }
}
```

- `serverUrl`: LiveKit server WebSocket URL (e.g. `wss://...livekit.cloud`)
- `token`: room access token (JWT) — fetched from the backend (see below)
- `protocol`: the agent protocol event bus (`AgentProtocol` instance)

When the LiveKit agent server sends text (via data channel), `LiveKitVoice` emits `speak { text, sentiment: 0 }` on the protocol bus so `agent-avatar.js` can react to it.

When the microphone track is active (user speaking), it emits `listen-start {}`. When VAD detects end-of-speech, it emits `listen-end { text }` (text from transcript, if provided by server).

### Token endpoint

Add `api/agents/[id]/livekit-token.js`:

```
GET /api/agents/:id/livekit-token
```

Returns `{ token: string, serverUrl: string }`. Uses the LiveKit server SDK to generate a room access token for the agent room (room name: `agent-${agentId}`). Requires authentication (session or bearer).

Environment variables needed:
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_SERVER_URL`

### Frontend integration

In `src/element.js`, when the `voice="livekit"` attribute is set:
1. Fetch `GET /api/agents/:id/livekit-token` for the token
2. Instantiate `LiveKitVoice({ serverUrl, token, protocol })`
3. Call `voice.connect()`
4. On element disconnect/destroy, call `voice.disconnect()`

---

## Files to create/edit

**Create:**
- `api/agents/[id]/livekit-token.js` — token endpoint. Use `livekit-server-sdk` (check if it's a project dep; if not, use `@livekit/agents` or generate the JWT manually using `jose` which IS a project dep — see LiveKit JWT format below).
- `src/runtime/livekit-voice.js` — `LiveKitVoice` class. Import `LivekitClient` from `livekit-client` npm package.

**Edit:**
- `src/runtime/speech.js` — export `LiveKitVoice` from `livekit-voice.js` via re-export for clean import surface. Add `createVoice(config)` factory that returns a `LiveKitVoice` when `config.provider === 'livekit'`.
- `src/element.js` — handle `voice="livekit"` attribute. Fetch token, connect, disconnect on cleanup.

**Do not touch:**
- `BrowserTTS`, `BrowserSTT`, `ElevenLabsTTS` — these remain as alternatives
- `src/agent-avatar.js` — it already reacts to `speak` events on the protocol bus

---

## LiveKit JWT format (if generating without server SDK)

```js
// Using `jose` (already a dep) to sign a LiveKit access token
import { SignJWT } from 'jose';
const secret = new TextEncoder().encode(process.env.LIVEKIT_API_SECRET);
const token = await new SignJWT({
  video: { roomJoin: true, room: roomName, canPublish: true, canSubscribe: true },
  sub: `user-${userId}`,
  iss: process.env.LIVEKIT_API_KEY,
  nbf: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
}).setProtectedHeader({ alg: 'HS256' }).sign(secret);
```

---

## LiveKit client pattern (reference from experiment)

```js
import { Room, RoomEvent, Track } from 'livekit-client';

const room = new Room();
await room.connect(serverUrl, token);

// Publish microphone
await room.localParticipant.setMicrophoneEnabled(true);

// Listen for agent audio
room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
  if (track.kind === Track.Kind.Audio) {
    const el = track.attach(); // returns <audio> element
    document.body.appendChild(el);
  }
});

// Listen for data messages from agent
room.on(RoomEvent.DataReceived, (data, participant) => {
  const msg = JSON.parse(new TextDecoder().decode(data));
  if (msg.type === 'transcript') {
    protocol.emit('speak', { text: msg.text, sentiment: 0 });
  }
});
```

---

## Acceptance criteria

1. Set `voice="livekit"` on `<agent-3d agent-id="...">`. The element fetches a token and connects to LiveKit.
2. Speak into the microphone — the LiveKit agent hears it and responds. The response audio plays through the browser.
3. When the agent responds, `agent-avatar.js` reacts to the `speak` event (emotion + lipsync if task `talkinghead-lipsync-agent-runtime.md` is also complete).
4. Removing the element (or navigating away) cleanly disconnects the room — no dangling audio tracks or event listeners.
5. Without `LIVEKIT_*` env vars set, the token endpoint returns a clear `503` with `{ error: 'livekit_not_configured' }` — it does not crash.
6. Without `voice="livekit"`, existing `BrowserSTT`/`BrowserTTS` behavior is unchanged.
7. `npx vite build` passes. `node --check src/runtime/livekit-voice.js` passes.

## Constraints

- `livekit-client` is the official npm package for the browser SDK. Check if it's already a project dependency (`package.json`). If not, add it. This is the one new dependency this task may introduce.
- `livekit-server-sdk` may be used on the backend if already present; otherwise generate the JWT with `jose`.
- ESM only. Tabs, 4-wide. Match existing style.
- `LiveKitVoice` must not import `agent-avatar.js` or anything from the emotion layer — use the protocol bus only.
- All audio cleanup (tracks, subscriptions, room) must happen in `disconnect()` to prevent memory leaks.
