# Architecture

This document describes the system design, data flow, and protocol of agent-voice-chat.

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │  Mic Capture  │    │  Agent UI    │    │ Audio Player  │   │
│  │  + VAD        │    │  + Chat      │    │ (Web Audio)   │   │
│  └──────┬───────┘    └──────┬───────┘    └──────▲───────┘   │
│         │                   │                   │            │
│         │    ┌──────────────┴──────────────┐    │            │
│         │    │     Socket.IO Client        │    │            │
│         └────┤     or WebRTC Connection    ├────┘            │
│              └──────────────┬──────────────┘                 │
└─────────────────────────────┼───────────────────────────────┘
                              │
                    WebSocket / WebRTC
                              │
┌─────────────────────────────┼───────────────────────────────┐
│                       Server (Node.js)                       │
│                              │                               │
│  ┌──────────────┐    ┌──────┴───────┐    ┌──────────────┐   │
│  │ Agent        │    │  Socket.IO   │    │ Room Manager  │   │
│  │ Registry     │    │  Handler     │    │ (Isolation)   │   │
│  └──────────────┘    └──────┬───────┘    └──────────────┘   │
│                             │                                │
│              ┌──────────────┼──────────────┐                 │
│              │              │              │                  │
│         ┌────▼────┐   ┌────▼────┐   ┌────▼────┐            │
│         │   STT   │   │   LLM   │   │   TTS   │            │
│         │ Provider│   │ Provider│   │ Provider│            │
│         └────┬────┘   └────┬────┘   └────┬────┘            │
└──────────────┼─────────────┼─────────────┼──────────────────┘
               │             │             │
          ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
          │ Groq    │   │ OpenAI  │   │ OpenAI  │
          │ Whisper │   │ Claude  │   │ 11Labs  │
          │ OpenAI  │   │ Groq    │   │ Browser │
          └─────────┘   └─────────┘   └─────────┘
```

## Audio Pipelines

There are two distinct audio paths depending on the provider type.

### WebRTC Path (OpenAI Realtime)

Lowest latency (~200ms). Audio flows directly between the browser and OpenAI.

```
User speaks
  │
  ▼
Mic capture (getUserMedia)
  │
  ▼
RTCPeerConnection ◄──── SDP exchange via /session/:agentId
  │                      (ephemeral token from server)
  ▼
Audio stream ──────────────────────► OpenAI Realtime API
                                          │
Response audio ◄──────────────────────────┘
  │
  ▼
Web Audio API playback

Text events flow via RTCDataChannel:
  - input_audio_buffer.speech_started/stopped
  - response.audio_transcript.delta/done
  - conversation.item.create (send text)
  - response.create (trigger response)
```

The server's role is minimal — it only provides the ephemeral session token. All audio and LLM processing happens directly between the browser and OpenAI.

### Socket Path (Claude, Groq, OpenAI Chat)

More flexible, supports any LLM provider. Higher latency (~400–1200ms).

```
User speaks
  │
  ▼
Mic capture (getUserMedia)
  │
  ▼
Voice Activity Detection (Web Audio AnalyserNode)
  ├── Speech detected: start MediaRecorder
  └── 1200ms silence: stop recording
  │
  ▼
Base64-encode audio blob
  │
  ▼
Socket.IO emit: audioData { agentId, audio, mimeType }
  │
  ▼
Server: STT transcribe (Groq Whisper or OpenAI Whisper)
  │
  ▼
Server: LLM streamResponse (async generator)
  │
  ├──► Socket.IO emit: textDelta { delta }  (repeated)
  │
  ▼
Server: collect full text
  │
  ├──► Socket.IO emit: textComplete { text }
  │
  ▼
Server: TTS synthesize (OpenAI / ElevenLabs)
  │
  ├──► Socket.IO emit: ttsAudio { audio: base64, format: "mp3" }
  │    └── Client: decode + play via Web Audio API
  │
  └──► Socket.IO emit: ttsBrowser { text }  (fallback)
       └── Client: browser speechSynthesis API
```

## Voice Activity Detection (VAD)

The client detects when the user is speaking using the Web Audio API:

```
Mic stream → AudioContext → AnalyserNode (FFT size 256)
  │
  ▼
Analyze frequency bins 3–25 (voice range)
  │
  ▼
Calculate average energy level (0.0 – 1.0)
  │
  ├── level > 0.04 → speech detected → start/continue recording
  └── level ≤ 0.04 for 1200ms → silence → stop recording, send audio
```

- Smoothing constant: 0.3
- Analysis rate: 30fps (every ~33ms)
- Speech threshold: 0.04 (4% energy)
- Silence timeout: 1200ms (user), 500ms (agent-to-agent)

## Turn Management

Agents take turns to prevent overlapping speech:

```
Agent 0 requests turn
  │
  ▼
Turn queue: [0]
  │
  ▼
currentTurn = null → grant immediately
  │
  ▼
Agent 0 has turn → LLM + TTS → speaks
  │
  ▼
Agent 0 releases turn
  │
  ▼
Check queue → Agent 1 waiting? → grant after 500ms delay
                                    │
                                    ▼
                              Agent 1 speaks
```

Rules:
- Only one agent speaks at a time
- If the turn is free, it's granted immediately
- If occupied, the agent is added to the queue
- On release, the next queued agent gets a 500ms delay (natural pacing)
- State is broadcast to all clients after every turn change

## Server Components

### Express Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/` | GET | Landing page |
| `/agent1`, `/agent2` | GET | Hardcoded agent pages |
| `/voice/:agentId` | GET | Dynamic agent page |
| `/config` | GET | Client configuration |
| `/state` | GET | Current state snapshot |
| `/session/:agentId` | GET | WebRTC session token |
| `/api/agents` | GET/POST | List or create agents |
| `/api/agents/:id` | GET/PUT/DELETE | Read, update, delete agent |

### Socket.IO Namespace: `/space`

All real-time events are on the `/space` namespace. See [API Reference](api-reference.md) for the full event protocol.

### Provider Factory

```
AI_PROVIDER env var
  │
  ├── "openai"      → openai-realtime.js (type: webrtc)
  ├── "openai-chat"  → openai-chat.js    (type: socket)
  ├── "claude"       → claude.js          (type: socket)
  └── "groq"         → groq.js            (type: socket)
```

### Conversation History

Per-agent, per-room message history:

```
ConversationHistory(maxHistory = 20)
  │
  ├── add(agentId, role, content) → append, trim if > max
  ├── get(agentId) → [{ role, content }, ...]
  └── clear(agentId) → reset
```

Maintains context for multi-turn conversations. Each agent has independent history so agents can have different "memories" of the conversation.

### Room Manager

Isolates state for multi-tenancy:

```
RoomManager
  │
  ├── createRoom(config) → new room with own state
  ├── getOrCreateRoom(roomId) → lazy creation
  ├── addClient(roomId, socketId) → track connection
  ├── removeClient(roomId, socketId) → cleanup
  └── cleanupStaleRooms() → delete empty rooms past TTL (every 5min)
```

Each room contains: agents state, turn queue, message history, client list, timestamps.

## Client Components

### agent-common.js

Base class for all agent pages:

- Socket.IO connection management
- DOM element binding (chat panel, status, mic button)
- Audio visualization (Web Audio API analyzer)
- Message rendering and history
- Status indicator management

### provider-openai-realtime.js

WebRTC provider client:

- Fetches ephemeral session token from `/session/:agentId`
- Creates RTCPeerConnection with STUN servers
- Exchanges SDP offer/answer with OpenAI
- Manages data channel for text events
- Handles bidirectional audio streams

### provider-socket.js

Socket.IO provider client:

- MediaRecorder for audio capture
- VAD for speech detection
- Base64 encoding and transmission
- Audio playback queue (prevents overlapping agent speech)
- Browser TTS fallback

## Data Models

### Message

```javascript
{
  id: "msg_abc123",
  agentId: 0,          // -1 for user messages
  name: "Bob",
  text: "Hey, what's up?",
  isUser: false,
  timestamp: "2026-03-23T10:05:00Z"
}
```

### Agent State

```javascript
{
  id: 0,
  name: "Bob",
  status: "idle",      // "idle" | "listening" | "speaking"
  connected: true,
  socketId: "socket_abc123"
}
```

### Room State

```javascript
{
  id: "room-id",
  agents: { 0: AgentState, 1: AgentState },
  currentTurn: null,
  turnQueue: [],
  messages: [Message],
  isProcessing: false,
  clients: Set<socketId>,
  createdAt: Date,
  lastActivity: Date,
  config: { agentIds, maxParticipants, ttlMinutes, isPublic }
}
```

## Security Model

- **API keys** are stored server-side only. They never reach the browser.
- **WebRTC tokens** are ephemeral (short-lived) and scoped to a single session.
- **Audio data** passes through the server for socket providers but is not persisted.
- **CORS** should be configured on the server if the widget is hosted on a different domain.
- **Microphone access** requires explicit browser permission from the user.
