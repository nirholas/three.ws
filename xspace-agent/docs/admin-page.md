# Admin Page & Frontend Pages

## public/admin.html — X Spaces Bot Control (215 lines)

### Purpose
A minimal control panel for managing the X Spaces Puppeteer bot. Accessible at `/admin`.

### UI Components
- **Status indicator** — colored dot (grey=disconnected, green=connected, yellow=working, red=error)
- **Status text** — current bot state
- **START BOT / STOP BOT** buttons
- **Space URL input** + JOIN SPACE / LEAVE SPACE buttons
- **2FA section** (hidden by default) — 6-digit code input, shown when X requires 2FA
- **Log panel** — scrollable timestamped event log

### Socket.IO Connection
Connects to `/space` namespace. All commands go through Socket.IO events:

| Button Action | Socket Event | Server Handler |
|---|---|---|
| START BOT | `xspace:start` | `xSpaces.start()` — launches browser, logs in |
| STOP BOT | `xspace:stop` | `xSpaces.stop()` — leaves Space, closes browser |
| JOIN SPACE | `xspace:join` | `xSpaces.joinSpace(url)` |
| LEAVE SPACE | `xspace:leave` | `xSpaces.leaveSpace()` |
| 2FA SUBMIT | `xspace:2fa` | `xSpaces.emitter.emit("2fa-code", code)` |

### Smart Join Logic
If bot is disconnected when user clicks JOIN, it auto-starts the bot first:
```js
if (currentStatus === 'disconnected') {
    _pendingJoinUrl = url  // save URL
    socket.emit('xspace:start')  // start bot
    // on 'logged-in' status, auto-emit xspace:join
}
```

### Status Events Received
- `xSpacesStatus` — bot state changes
- `xSpacesError` — error messages
- `xSpaces2faRequired` — shows 2FA input section

### Styling
Dark terminal aesthetic — black background (#0a0a0a), monospace font, green/red/amber accents.

---

## public/index.html — X Space Dashboard (~500 lines)

### Purpose
The main viewer page for X Space conversations. Shows real-time agent dialogue with a retro CRT terminal aesthetic. Accessible at `/`.

### Features
- Two ASCII art agent faces (Agent 0 = cyan, Agent 1 = green)
- Real-time text streaming with typewriter effect
- Audio playback (WebRTC or TTS)
- Chat input for sending messages to agents
- Status indicators for each agent
- Live trades bar (from PumpPortal)
- Live chat sidebar (from Pump.fun or manual)

### Architecture
- Connects to `/space` Socket.IO namespace
- Handles both WebRTC and Socket provider modes
- Agent face animations glow when speaking

---

## public/agent1.html / agent2.html — Individual Agent Pages

### Purpose
Each agent has its own control page where it can be independently connected. These pages run the AI agent in the browser.

- **agent1.html**: Agent 0 "Bob" (purple theme)
- **agent2.html**: Agent 1 "Alice" (pink theme)

### How They Work
1. Load `agent-common.js` — shared Socket.IO handlers, UI helpers
2. Load `provider-openai-realtime.js` + `provider-socket.js` — both provider implementations
3. Set `AGENT_CONFIG` with agentId, name, session endpoint
4. Load `agent-loader.js` — fetches `/config` from server, initializes correct provider

### WebRTC Mode (OpenAI Realtime)
- Agent page gets ephemeral token from `/session/:agentId`
- Creates RTCPeerConnection directly to OpenAI
- Audio flows: mic → OpenAI → response audio → speaker
- Text events forwarded to server via Socket.IO for dashboard display
- Agent 0 receives chat messages via data channel

### Socket Mode (Claude/Groq)
- Agent page captures mic audio via MediaRecorder
- VAD detects speech (threshold 0.04, silence timeout 1.2s)
- Sends audio as base64 to server via `audioData` event
- Server handles STT → LLM → TTS pipeline
- Receives `ttsAudio` (server-side TTS) or `ttsBrowser` (browser TTS fallback)

---

## public/js/agent-common.js — Shared Agent Class (176 lines)

**`AgentCommon`** class handles:
- Socket.IO connection to `/space`
- Connection/disconnection lifecycle
- Turn management UI (my-turn / waiting)
- Audio level visualization
- Speech detection via frequency analysis
- Chat panel management (self/other/user message styling)
- Status updates to server

---

## public/js/agent-loader.js — Provider Bootstrapper (30 lines)

- Reads `AGENT_CONFIG` from window (set by agent HTML)
- Creates `AgentCommon` instance
- Fetches `/config` to determine provider type
- Calls `initOpenAIRealtime(agent)` or `initSocketProvider(agent)`

---

## public/js/provider-openai-realtime.js — WebRTC Provider (159 lines)

- Creates RTCPeerConnection with STUN server
- Gets ephemeral key from `/session/:agentId`
- Sends SDP offer to OpenAI Realtime API
- Handles data channel messages:
  - `input_audio_buffer.speech_started/stopped`
  - `response.created` → request turn
  - `response.audio_transcript.delta` → emit textDelta
  - `response.audio_transcript.done` → emit textComplete
  - `conversation.item.created` (user) → log transcription
- Agent 0 receives `textToAgent` events and injects them as conversation items

---

## public/js/provider-socket.js — Socket Provider (205 lines)

- Captures mic via `getUserMedia`
- MediaRecorder records audio chunks (100ms intervals)
- VAD with frequency analysis (threshold 0.04, silence 1.2s)
- On silence: stops recording, converts to base64, sends `audioData` event
- Receives `ttsAudio` events → decodes and plays via AudioContext
- Receives `ttsBrowser` events → uses browser's `speechSynthesis`
- Queues playback to prevent overlap


