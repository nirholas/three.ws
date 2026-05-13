# API Reference

agent-voice-chat exposes both REST endpoints and a Socket.IO real-time API.

## REST Endpoints

### GET /config

Returns the server's current configuration (safe to expose to clients).

**Response:**
```json
{
  "inputChat": true,
  "avatarUrl1": "",
  "avatarUrl2": "",
  "aiProvider": "openai",
  "providerType": "webrtc",
  "ttsMode": "server"
}
```

### GET /state

Returns the current global state including connected agents and recent messages.

**Response:**
```json
{
  "agents": {
    "0": {
      "id": 0,
      "name": "Bob",
      "status": "idle",
      "connected": true,
      "socketId": "abc123"
    },
    "1": {
      "id": 1,
      "name": "Alice",
      "status": "idle",
      "connected": false,
      "socketId": null
    }
  },
  "currentTurn": null,
  "messages": []
}
```

Messages are capped at the last 50 entries.

### GET /session/:agentId

**WebRTC providers only.** Creates an ephemeral OpenAI Realtime session for the given agent.

**Parameters:**
- `agentId` (path) — Agent index (0, 1, etc.)

**Response:**
```json
{
  "client_secret": {
    "value": "ek_abc123..."
  }
}
```

The client uses this token to establish a WebRTC peer connection directly with OpenAI's API.

### GET /api/agents

Returns all registered agents (public fields only — no system prompts).

**Response:**
```json
[
  {
    "id": "bob",
    "name": "Bob",
    "voice": "verse",
    "avatar": "/assets/bob.png",
    "theme": { "primary": "#818cf8" }
  }
]
```

### GET /api/agents/:id

Returns a single agent by ID.

### POST /api/agents

Create a new agent at runtime.

**Request Body:**
```json
{
  "id": "alex",
  "name": "Alex",
  "personality": "You're Alex. Calm and thoughtful...",
  "voice": "echo"
}
```

### PUT /api/agents/:id

Update an existing agent's configuration.

### DELETE /api/agents/:id

Remove an agent.

---

## Socket.IO Protocol

All real-time communication uses Socket.IO on the `/space` namespace.

### Connecting

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/space');

// Register as an agent viewer
socket.emit('agentConnect', { agentId: 0 });
```

### Client → Server Events

#### `agentConnect`
Register a client as a viewer/controller for an agent.

```javascript
socket.emit('agentConnect', { agentId: 0 });
```

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | number | Agent index to connect as |

#### `agentDisconnect`
Unregister from an agent slot.

```javascript
socket.emit('agentDisconnect', { agentId: 0 });
```

#### `audioData`
Send recorded audio from the user's microphone for STT processing.

```javascript
socket.emit('audioData', {
  agentId: 0,
  audio: 'base64-encoded-audio-data',
  mimeType: 'audio/webm;codecs=opus'
});
```

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | number | Which agent should respond |
| `audio` | string | Base64-encoded audio |
| `mimeType` | string | Audio MIME type |

#### `userMessage`
Send a text message (from the chat input box).

```javascript
socket.emit('userMessage', {
  text: 'Hello, how are you?',
  from: 'Alice'
});
```

#### `requestTurn`
Request the speaking turn for an agent.

```javascript
socket.emit('requestTurn', { agentId: 0 });
```

#### `releaseTurn`
Release the speaking turn back to the queue.

```javascript
socket.emit('releaseTurn', { agentId: 0 });
```

#### `statusChange`
Update an agent's status indicator.

```javascript
socket.emit('statusChange', {
  agentId: 0,
  status: 'speaking' // 'idle' | 'listening' | 'speaking'
});
```

#### `audioLevel`
Send audio visualization level (0–1 float).

```javascript
socket.emit('audioLevel', { agentId: 0, level: 0.65 });
```

### Server → Client Events

#### `stateUpdate`
Broadcast whenever state changes (agent connect/disconnect, turn change).

```javascript
socket.on('stateUpdate', (state) => {
  // state.agents, state.currentTurn, state.turnQueue
});
```

#### `turnGranted`
An agent has been granted the speaking turn.

```javascript
socket.on('turnGranted', ({ agentId }) => {
  console.log(`Agent ${agentId} now has the turn`);
});
```

#### `textDelta`
Streaming text chunk from an agent's LLM response.

```javascript
socket.on('textDelta', ({ agentId, delta, messageId, name }) => {
  // Append delta to the current message
});
```

#### `textComplete`
Full completed message from an agent.

```javascript
socket.on('textComplete', ({ id, agentId, name, text, timestamp }) => {
  // Replace streaming text with final version
});
```

#### `ttsAudio`
Synthesized audio from the server's TTS service.

```javascript
socket.on('ttsAudio', ({ agentId, audio, format }) => {
  // audio = base64 string, format = "mp3"
  const buffer = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
  // Decode and play via Web Audio API
});
```

#### `ttsBrowser`
Fallback: text to be spoken via the browser's `speechSynthesis` API.

```javascript
socket.on('ttsBrowser', ({ agentId, text }) => {
  const utterance = new SpeechSynthesisUtterance(text);
  speechSynthesis.speak(utterance);
});
```

#### `messageHistory`
Sent on connect — array of previous messages in the session.

```javascript
socket.on('messageHistory', (messages) => {
  // Render existing conversation
});
```

#### `userMessage`
Broadcast when a user sends a text message.

```javascript
socket.on('userMessage', ({ id, agentId, name, text, isUser }) => {
  // agentId is -1 for user messages
});
```

#### `agentStatus`
Agent status change notification.

```javascript
socket.on('agentStatus', ({ agentId, status, name }) => {
  // status: 'idle' | 'speaking' | 'listening'
});
```

#### `audioLevel`
Audio visualization data for an agent.

```javascript
socket.on('audioLevel', ({ agentId, level }) => {
  // Update visualizer (level is 0–1)
});
```

## Event Flow Examples

### Voice Conversation (Socket Provider)

```
Client                          Server
  |                               |
  |-- agentConnect {agentId:0} -->|
  |<-- stateUpdate --------------|
  |<-- messageHistory ------------|
  |                               |
  | [user speaks into mic]        |
  |-- audioData {audio,agentId}-->|
  |                               |-- STT transcribe
  |                               |-- LLM stream
  |<-- textDelta {delta} --------|  (repeated)
  |<-- textComplete {text} ------|
  |<-- ttsAudio {audio} ---------|
  | [plays audio]                 |
```

### Voice Conversation (WebRTC Provider)

```
Client                          Server              OpenAI
  |                               |                    |
  |-- GET /session/0 ----------->|                    |
  |<-- {client_secret} ----------|                    |
  |                               |                    |
  |-- WebRTC offer ------------------------------------->|
  |<-- WebRTC answer ------------------------------------|
  |                               |                    |
  | [audio streams bidirectionally via WebRTC]          |
  |                               |                    |
  |-- agentConnect {agentId:0} -->|                    |
  |<-- stateUpdate --------------|                    |
```
