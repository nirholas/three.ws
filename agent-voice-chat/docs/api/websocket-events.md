# WebSocket Events Reference

Complete Socket.IO event reference for the `@xspace/server` admin panel. Covers the `/space` namespace used by dashboard clients to control and monitor agents, the `/events` namespace for tenant-scoped event streaming, and the SSE endpoint for HTTP-based event consumption.

---

## Connection

### URL and Namespace

The primary control namespace is `/space`:

```
ws://localhost:3000/space
```

The event-streaming namespace is `/events`:

```
ws://localhost:3000/events
```

The server is configured with:

| Option | Value |
|---|---|
| CORS origins | `CORS_ORIGINS` env var (comma-separated) or `http://localhost:{PORT}` |
| Allowed methods | `GET`, `POST` |
| Credentials | `true` |
| Ping timeout | 60 000 ms |
| Ping interval | 25 000 ms |

### Authentication Handshake

When `ADMIN_API_KEY` is set, every socket connection to `/space` must authenticate. The middleware checks two locations (first match wins):

1. `socket.handshake.auth.apiKey`
2. `socket.handshake.headers['x-api-key']`

Comparison uses `crypto.timingSafeEqual` to prevent timing attacks. On failure the socket receives an `Error('unauthorized')` and is disconnected.

```typescript
import { io } from 'socket.io-client'

const socket = io('http://localhost:3000/space', {
  auth: {
    apiKey: 'your-admin-api-key',
  },
})
```

### On Connection

When a client connects to `/space`, the server immediately emits three events to the connecting socket:

1. **`stateUpdate`** -- current agent status and Space URL
2. **`messageHistory`** -- last 50 messages from the conversation buffer
3. **`health`** -- server health snapshot

If an agent is active, the server also replays the last 20 FSM transitions as individual `state:change` events.

### Rate Limiting

All client-to-server events on `/space` are rate-limited to **30 events per 10 seconds** per socket. Exceeding the limit emits an `xSpacesError` with `"Rate limit exceeded. Slow down."`.

---

## Client-to-Server Events (`/space`)

All events are validated against Zod schemas defined in `SocketEventSchemas`. Invalid payloads produce an `xSpacesError` response. Events without a registered schema pass through unchanged.

### `xspace:start`

Create a new agent and join an X Space.

**Payload Schema:**

```typescript
interface XSpaceStartPayload {
  /** Full X Space URL. Must match https://x.com/i/spaces/... or https://twitter.com/i/spaces/... */
  spaceUrl: string
}
```

Zod validation: `z.object({ spaceUrl: SpaceUrlSchema })` where `SpaceUrlSchema` enforces a valid URL with hostname `x.com` or `twitter.com` and pathname matching `/i/spaces/[A-Za-z0-9]+`.

**Behavior:** Creates a new `XSpaceAgent` with the server's config, registers all event listeners (status, transcription, response, error, space-ended, and dashboard telemetry), then calls `agent.join(spaceUrl)`. Emits `xSpacesError` if an agent is already running.

**Example:**

```typescript
socket.emit('xspace:start', {
  spaceUrl: 'https://x.com/i/spaces/1eaKbrPAqBwKX',
})
```

---

### `xspace:stop`

Stop the running agent and reset all state.

**Payload Schema:** None (no payload required).

**Behavior:** Calls `agent.destroy()`, then resets status to `'disconnected'`, clears `spaceUrl`, `startedAt`, and `totalCost`. Broadcasts `xSpacesStatus` with `{ status: 'disconnected' }` to all connected clients.

**Example:**

```typescript
socket.emit('xspace:stop')
```

---

### `xspace:join`

Join a different Space with an already-running agent.

**Payload Schema:**

```typescript
interface XSpaceJoinPayload {
  /** Full X Space URL. Same validation as xspace:start. */
  spaceUrl: string
}
```

**Behavior:** Calls `agent.join(spaceUrl)` on the existing agent. Emits `xSpacesError` if no agent is running.

**Example:**

```typescript
socket.emit('xspace:join', {
  spaceUrl: 'https://x.com/i/spaces/1eaKbrPAqBwKX',
})
```

---

### `xspace:leave`

Leave the current Space without destroying the agent.

**Payload Schema:** None (no payload required).

**Behavior:** Calls `agent.leave()` and clears the stored `spaceUrl`. The agent remains alive and can join another Space.

**Example:**

```typescript
socket.emit('xspace:leave')
```

---

### `xspace:2fa`

Submit a two-factor authentication code during the login flow.

**Payload Schema:**

```typescript
interface XSpace2FAPayload {
  /** 6-8 digit numeric code. */
  code: string
}
```

Zod validation: `z.object({ code: z.string().regex(/^\d{6,8}$/, 'Must be a 6-8 digit code') })`

**Behavior:** Emits `'2fa-code'` on the agent, which the browser auth module consumes to complete login.

**Example:**

```typescript
socket.emit('xspace:2fa', { code: '123456' })
```

---

### `xspace:status`

Request the current agent status.

**Payload Schema:** None (no payload required).

**Behavior:** Responds to the requesting socket only with an `xSpacesStatus` event containing `{ status, spaceUrl }`.

**Example:**

```typescript
socket.emit('xspace:status')
// Server responds with:
// socket.emit('xSpacesStatus', { status: 'listening', spaceUrl: '...' })
```

---

### `orchestrator:force-speak`

Force a specific bot in a multi-agent team to speak.

**Payload Schema:**

```typescript
interface OrchestratorForceSpeakPayload {
  /** Identifier of the bot to force. 1-100 characters. */
  botId: string
}
```

Zod validation: `z.object({ botId: z.string().min(1).max(100) })`

**Behavior:** Emits `'orchestrator:force-speak'` on the agent with `{ botId }`.

**Example:**

```typescript
socket.emit('orchestrator:force-speak', { botId: 'agent-alice' })
```

---

### `admin:override-selector`

Override a CSS selector used by the browser automation layer. Validated but the socket handler is not registered in the default `/space` namespace -- it exists as a validated schema for use in custom server extensions.

**Payload Schema:**

```typescript
interface AdminOverrideSelectorPayload {
  /** Selector name matching a key in SELECTOR_DEFINITIONS. 1-100 characters. */
  name: string
  /** New CSS selector string. 1-500 characters. */
  selector: string
}
```

Zod validation: `z.object({ name: z.string().min(1).max(100), selector: z.string().min(1).max(500) })`

> **Note:** The REST endpoint `POST /admin/selectors/:name` provides the same functionality over HTTP and is the recommended approach.

---

## Server-to-Client Events (`/space`)

Events are broadcast to all connected clients in the `/space` namespace unless noted otherwise.

### `stateUpdate`

Sent to a socket immediately on connection. Provides the current agent state snapshot.

**Payload:**

```typescript
interface StateUpdatePayload {
  /** Current agent lifecycle status. */
  status: AgentStatus
  /** URL of the Space the agent is in, or null. */
  spaceUrl: string | null
}
```

**`AgentStatus` values:**

```typescript
type AgentStatus =
  | 'disconnected'
  | 'launching'
  | 'authenticating'
  | 'connected'
  | 'joining'
  | 'listening'
  | 'idle'
  | 'processing'
  | 'speaking'
  | 'leaving'
  | 'space-ended'
  | 'error'
```

**Example payload:**

```json
{
  "status": "listening",
  "spaceUrl": "https://x.com/i/spaces/1eaKbrPAqBwKX"
}
```

---

### `messageHistory`

Sent to a socket immediately on connection. Contains the last 50 messages from the conversation buffer.

**Payload:**

```typescript
type MessageHistoryPayload = SpaceMessage[]

interface SpaceMessage {
  /** Unique message ID (timestamp-based). */
  id: string
  /** Agent index (-1 for human speakers, 0+ for agents). */
  agentId: number
  /** Display name of the speaker. */
  name: string
  /** Transcribed or generated text content. */
  text: string
  /** Unix timestamp in milliseconds. */
  timestamp: number
  /** True if this is a human speaker's transcription. */
  isUser?: boolean
}
```

**Example payload:**

```json
[
  {
    "id": "1711500000000",
    "agentId": -1,
    "name": "Speaker 1",
    "text": "What do you think about AI agents?",
    "timestamp": 1711500000000,
    "isUser": true
  },
  {
    "id": "1711500003000",
    "agentId": 0,
    "name": "Agent",
    "text": "AI agents are transforming how we interact with digital spaces...",
    "timestamp": 1711500003000
  }
]
```

---

### `health`

Sent to a socket immediately on connection. Server health snapshot.

**Payload:**

```typescript
interface HealthPayload {
  /** Current agent status. */
  status: AgentStatus
  /** Seconds since agent started, or 0 if not running. */
  uptime: number
  /** Unix timestamp in milliseconds. */
  timestamp: number
}
```

**Example payload:**

```json
{
  "status": "listening",
  "uptime": 3600.5,
  "timestamp": 1711503600000
}
```

---

### `state:change`

Emitted whenever the agent's finite state machine transitions between states. On connection, the last 20 transitions are replayed.

**Payload:**

```typescript
interface StateChangePayload {
  /** Previous FSM state. */
  from: string
  /** New FSM state. */
  to: string
  /** Event that triggered the transition. */
  event: string
  /** Unix timestamp in milliseconds when the transition occurred. */
  timestamp: number
}
```

**Example payload:**

```json
{
  "from": "joining",
  "to": "listening",
  "event": "JOINED",
  "timestamp": 1711500120000
}
```

---

### `xSpacesStatus`

Broadcast when the agent's status changes or when a status request is fulfilled.

**Payload:**

```typescript
interface XSpacesStatusPayload {
  /** Current agent status. May include 'space-ended' when the Space concludes. */
  status: AgentStatus | 'space-ended'
  /** Present when responding to xspace:status. */
  spaceUrl?: string | null
}
```

**Example payload:**

```json
{ "status": "speaking" }
```

```json
{ "status": "disconnected" }
```

---

### `textComplete`

Emitted when a transcription or agent response is finalized. This is the primary event for building chat UIs.

**Payload:**

```typescript
interface TextCompletePayload extends SpaceMessage {
  id: string
  agentId: number
  name: string
  text: string
  timestamp: number
  isUser?: boolean
}
```

- `agentId: -1` + `isUser: true` -- human speaker transcription
- `agentId: 0` + `name: 'Agent'` -- agent response

**Example payload (transcription):**

```json
{
  "id": "1711500060000",
  "agentId": -1,
  "name": "Speaker 2",
  "text": "Can you explain how voice activity detection works?",
  "timestamp": 1711500060000,
  "isUser": true
}
```

**Example payload (response):**

```json
{
  "id": "1711500062000",
  "agentId": 0,
  "name": "Agent",
  "text": "Voice activity detection analyzes audio energy levels to distinguish speech from silence...",
  "timestamp": 1711500062000
}
```

---

### `audio:level`

Real-time audio level telemetry, forwarded from the agent's audio pipeline.

**Payload:**

```typescript
interface AudioLevelPayload {
  /** RMS audio level (0.0 - 1.0). */
  level: number
  /** Whether voice activity is currently detected. */
  speaking: boolean
  /** Unix timestamp in milliseconds. */
  timestamp: number
}
```

**Example payload:**

```json
{
  "level": 0.42,
  "speaking": true,
  "timestamp": 1711500065000
}
```

---

### `audio:webrtc-stats`

WebRTC connection statistics from the browser's RTCPeerConnection.

**Payload:**

```typescript
interface AudioWebRTCStatsPayload {
  /** Inbound audio bitrate in bits per second. */
  inboundBitrate: number
  /** Outbound audio bitrate in bits per second. */
  outboundBitrate: number
  /** Round-trip time in milliseconds. */
  roundTripTime: number
  /** Packet loss ratio (0.0 - 1.0). */
  packetLoss: number
  /** Jitter in seconds. */
  jitter: number
  /** Unix timestamp in milliseconds. */
  timestamp: number
}
```

**Example payload:**

```json
{
  "inboundBitrate": 32000,
  "outboundBitrate": 32000,
  "roundTripTime": 45,
  "packetLoss": 0.001,
  "jitter": 0.003,
  "timestamp": 1711500070000
}
```

---

### `turn:decision`

Emitted when the decision engine evaluates whether the agent should respond.

**Payload:**

```typescript
interface TurnDecisionPayload {
  /** Whether the agent decided to respond. */
  shouldRespond: boolean
  /** Confidence score (0.0 - 1.0). */
  confidence: number
  /** Reason for the decision. */
  reason: string
  /** Signals that contributed to the decision. */
  signals: {
    directlyAddressed: boolean
    isQuestion: boolean
    topicRelevance: number
    silenceDuration: number
  }
  /** Unix timestamp in milliseconds. */
  timestamp: number
}
```

**Example payload:**

```json
{
  "shouldRespond": true,
  "confidence": 0.85,
  "reason": "Directly addressed by name",
  "signals": {
    "directlyAddressed": true,
    "isQuestion": true,
    "topicRelevance": 0.9,
    "silenceDuration": 2.1
  },
  "timestamp": 1711500075000
}
```

---

### `provider:status`

Provider health and availability updates.

**Payload:**

```typescript
interface ProviderStatusPayload {
  /** Provider identifier (e.g., 'openai', 'groq', 'elevenlabs'). */
  provider: string
  /** Whether the provider is currently healthy. */
  ok: boolean
  /** Last measured latency in milliseconds. */
  latencyMs: number
  /** Error message if unhealthy. */
  error?: string
  /** Timestamp of the health check. */
  timestamp: number
}
```

**Example payload:**

```json
{
  "provider": "openai",
  "ok": true,
  "latencyMs": 120,
  "timestamp": 1711500080000
}
```

---

### `provider:cost`

Cumulative cost tracking updates. The server also stores the latest `totalCost` in its state.

**Payload:**

```typescript
interface ProviderCostPayload {
  /** Provider identifier. */
  provider: string
  /** Cost of the last operation in USD. */
  lastCostUsd: number
  /** Cumulative session cost in USD. */
  totalCost: number
  /** Breakdown by operation type. */
  breakdown?: {
    llm: number
    stt: number
    tts: number
  }
  /** Unix timestamp in milliseconds. */
  timestamp: number
}
```

**Example payload:**

```json
{
  "provider": "openai",
  "lastCostUsd": 0.0032,
  "totalCost": 0.1450,
  "breakdown": {
    "llm": 0.12,
    "stt": 0.02,
    "tts": 0.005
  },
  "timestamp": 1711500085000
}
```

---

### `selectors:health`

Validation results for browser automation CSS selectors.

**Payload:**

```typescript
interface SelectorsHealthPayload {
  /** Total number of selectors checked. */
  total: number
  /** Number of selectors that resolved successfully. */
  healthy: number
  /** Number of selectors that failed to resolve. */
  broken: number
  /** Details for each failed selector. */
  failures: Array<{
    name: string
    strategies: string[]
    error: string
  }>
  /** Unix timestamp in milliseconds. */
  timestamp: number
}
```

**Example payload:**

```json
{
  "total": 12,
  "healthy": 11,
  "broken": 1,
  "failures": [
    {
      "name": "speakerRequestButton",
      "strategies": ["css", "text", "aria"],
      "error": "No strategy found element"
    }
  ],
  "timestamp": 1711500090000
}
```

---

### `circuit:state-change`

Emitted when a provider's circuit breaker changes state. Used for resilience monitoring.

**Payload:**

```typescript
interface CircuitStateChangePayload {
  /** Provider identifier. */
  provider: string
  /** Previous circuit state. */
  from: 'closed' | 'open' | 'half-open'
  /** New circuit state. */
  to: 'closed' | 'open' | 'half-open'
  /** Number of consecutive failures that triggered the change. */
  failureCount: number
  /** Unix timestamp in milliseconds. */
  timestamp: number
}
```

**Example payload:**

```json
{
  "provider": "groq",
  "from": "closed",
  "to": "open",
  "failureCount": 5,
  "timestamp": 1711500095000
}
```

---

### `orchestrator:bot-status`

Status update for an individual bot in a multi-agent team.

**Payload:**

```typescript
interface OrchestratorBotStatusPayload {
  /** Bot identifier. */
  botId: string
  /** Current bot state. */
  status: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'
  /** Optional status message. */
  message?: string
  /** Unix timestamp in milliseconds. */
  timestamp: number
}
```

**Example payload:**

```json
{
  "botId": "agent-alice",
  "status": "speaking",
  "timestamp": 1711500100000
}
```

---

### `orchestrator:speaking`

Indicates which bot in a multi-agent team is currently speaking.

**Payload:**

```typescript
interface OrchestratorSpeakingPayload {
  /** Bot identifier of the current speaker, or null if nobody is speaking. */
  botId: string | null
  /** Text being spoken, if available. */
  text?: string
  /** Unix timestamp in milliseconds. */
  timestamp: number
}
```

**Example payload:**

```json
{
  "botId": "agent-bob",
  "text": "I think the key insight here is...",
  "timestamp": 1711500105000
}
```

---

### `xSpacesError`

Error notifications. Sent to the originating socket (not broadcast) when an event handler fails, validation fails, or rate limits are exceeded.

**Payload:**

```typescript
interface XSpacesErrorPayload {
  /** Human-readable error message. Secrets are automatically redacted. */
  error: string
}
```

**Example payloads:**

```json
{ "error": "Agent already running" }
```

```json
{ "error": "Invalid payload: Must be a valid X Space URL (https://x.com/i/spaces/...)" }
```

```json
{ "error": "Rate limit exceeded. Slow down." }
```

```json
{ "error": "No agent running. Start bot first." }
```

---

### `log`

Structured log forwarding. Broadcasts server-side log messages to all dashboard clients.

**Payload:**

```typescript
interface LogPayload {
  /** Log level. */
  level: 'info' | 'warn' | 'error' | 'debug'
  /** Log message. Secrets are automatically redacted. */
  message: string
  /** Unix timestamp in milliseconds. */
  timestamp: number
  /** Optional structured context. */
  context?: Record<string, unknown>
}
```

**Example payload:**

```json
{
  "level": "info",
  "message": "Agent joined Space: https://x.com/i/spaces/1eaKbrPAqBwKX",
  "timestamp": 1711500110000
}
```

---

## Event Streaming Namespace (`/events`)

The `/events` namespace provides tenant-scoped, filterable event streaming. It uses a separate authentication mechanism (tenant middleware) and is designed for programmatic consumers rather than the admin dashboard.

### Connection

```typescript
const socket = io('http://localhost:3000/events', {
  auth: { apiKey: 'your-key' },
})
```

**Connection limits:** Maximum 50 concurrent WebSocket connections per organization (configurable via `maxPerOrg`). Exceeding the limit emits `error` with `{ message: 'Too many connections for this organization' }` and disconnects the socket.

### Client-to-Server Events

#### `subscribe`

Subscribe to a filtered stream of events.

**Payload:**

```typescript
interface EventFilter {
  /** Glob patterns for event types, e.g. ['transcription.*', 'response.generated']. */
  events?: string[]
  /** Filter to specific session IDs. */
  sessions?: string[]
  /** Filter to specific agent IDs. */
  agents?: string[]
}
```

**Acknowledgement callback:**

```typescript
interface SubscribeAck {
  ok: boolean
  subscriptionId?: string
  error?: string
}
```

**Example:**

```typescript
socket.emit('subscribe', {
  events: ['transcription.*', 'response.*'],
  sessions: ['sess_abc123'],
}, (ack) => {
  console.log('Subscribed:', ack.subscriptionId)
})
```

#### `unsubscribe`

Unsubscribe from all active subscriptions on this socket.

**Payload:** `EventFilter` (currently unused -- all subscriptions are removed).

**Acknowledgement callback:**

```typescript
interface UnsubscribeAck {
  ok: boolean
}
```

#### `replay`

Replay missed events from the in-memory buffer.

**Payload:**

```typescript
interface ReplayOptions {
  /** Replay events for a specific session. */
  sessionId?: string
  /** Replay events after this event ID. */
  sinceEventId?: string
  /** Maximum events to return (default 100, max 500). */
  limit?: number
}
```

**Acknowledgement callback:** Returns `EventEnvelope[]`.

**Example:**

```typescript
socket.emit('replay', {
  sinceEventId: 'evt_a1b2c3d4e5f6g7h8',
  limit: 50,
}, (events) => {
  console.log(`Replayed ${events.length} events`)
})
```

### Server-to-Client Events

#### `event`

Delivered for each event matching the client's subscription filters.

**Payload:**

```typescript
interface EventEnvelope {
  /** Unique event ID for replay / deduplication (e.g. 'evt_a1b2c3d4e5f6g7h8'). */
  id: string
  /** ISO-8601 timestamp of when the event was published. */
  timestamp: string
  /** The org that owns this event. */
  orgId: string
  /** The wrapped event. */
  event: StreamEvent
}
```

**`StreamEvent` is a discriminated union:**

```typescript
type StreamEvent =
  | TranscriptionChunkEvent
  | ResponseThinkingEvent
  | ResponseGeneratedEvent
  | ResponseSpokenEvent
  | SessionMetricsEvent
  | AgentStateChangeEvent
  | AgentErrorEvent
  | TeamTurnChangeEvent
  | TeamHandoffEvent
  | UsageThresholdEvent
  | SystemAnnouncementEvent
```

**Individual event types:**

```typescript
interface TranscriptionChunkEvent {
  type: 'transcription.chunk'
  data: {
    sessionId: string
    speaker: string
    text: string
    timestamp: number
    isFinal: boolean
  }
}

interface ResponseThinkingEvent {
  type: 'response.thinking'
  data: {
    sessionId: string
    agentId: string
  }
}

interface ResponseGeneratedEvent {
  type: 'response.generated'
  data: {
    sessionId: string
    agentId: string
    text: string
    tokens: number
    latencyMs: number
  }
}

interface ResponseSpokenEvent {
  type: 'response.spoken'
  data: {
    sessionId: string
    agentId: string
    durationMs: number
  }
}

interface SessionMetricsEvent {
  type: 'session.metrics'
  data: {
    sessionId: string
    activeSpeakers: number
    sentiment: number
    topicShift: boolean
  }
}

interface AgentStateChangeEvent {
  type: 'agent.state_change'
  data: {
    agentId: string
    from: string
    to: string
  }
}

interface AgentErrorEvent {
  type: 'agent.error'
  data: {
    agentId: string
    error: string
    recoverable: boolean
  }
}

interface TeamTurnChangeEvent {
  type: 'team.turn_change'
  data: {
    teamId: string
    fromAgent: string
    toAgent: string
    reason: string
  }
}

interface TeamHandoffEvent {
  type: 'team.handoff'
  data: {
    teamId: string
    fromAgent: string
    toAgent: string
  }
}

interface UsageThresholdEvent {
  type: 'usage.threshold'
  data: {
    metric: string
    percentage: number
  }
}

interface SystemAnnouncementEvent {
  type: 'system.announcement'
  data: {
    message: string
    severity: 'info' | 'warning' | 'critical'
  }
}
```

**Example envelope:**

```json
{
  "id": "evt_a1b2c3d4e5f6g7h8",
  "timestamp": "2026-03-27T10:30:00.000Z",
  "orgId": "org_xyz",
  "event": {
    "type": "transcription.chunk",
    "data": {
      "sessionId": "sess_abc123",
      "speaker": "Speaker 1",
      "text": "What are the implications of this approach?",
      "timestamp": 1711500180000,
      "isFinal": true
    }
  }
}
```

---

## SSE Stream

### `GET /v1/events/stream`

Server-Sent Events endpoint for HTTP-based event consumption. Requires tenant authentication.

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `events` | `string` | Comma-separated glob patterns for event types (e.g. `transcription.*,response.*`) |
| `session` | `string` | Comma-separated session IDs to filter |
| `agent` | `string` | Comma-separated agent IDs to filter |

**Headers:**

| Header | Description |
|---|---|
| `Last-Event-ID` | Resume from this event ID (replays up to 100 missed events) |

**Response Headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

### Wire Format

Each event follows the standard SSE format:

```
id: evt_a1b2c3d4e5f6g7h8
event: transcription.chunk
data: {"sessionId":"sess_abc123","speaker":"Speaker 1","text":"Hello","timestamp":1711500180000,"isFinal":true}

```

- **`id`** -- unique event ID, usable with `Last-Event-ID` for reconnection replay
- **`event`** -- the `StreamEvent.type` value
- **`data`** -- JSON-serialized `StreamEvent.data`

The server sends a `retry` hint on connection:

```
retry: 3000

```

Heartbeats are sent every 30 seconds to keep the connection alive:

```
:keepalive

```

On server shutdown, a `reconnect` event is sent before closing:

```
event: reconnect
data: {"reason":"server_shutdown"}

```

### Backpressure

The server checks the kernel write buffer before sending each event. If the buffer exceeds the high-water mark (default 16 KB), the event is silently dropped to prevent memory buildup on slow clients.

### Replay Endpoint

#### `GET /v1/events/replay`

Fetch missed events without holding an SSE connection open.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `session` | `string` | -- | Session ID to filter |
| `since` | `string` | -- | Event ID to replay after |
| `limit` | `number` | `100` | Maximum events to return (max 500) |

**Response:**

```json
{
  "events": [ /* EventEnvelope[] */ ],
  "count": 42,
  "hasMore": false
}
```

### Example: Connecting with EventSource

```typescript
const url = new URL('http://localhost:3000/v1/events/stream')
url.searchParams.set('events', 'transcription.*,response.*')
url.searchParams.set('session', 'sess_abc123')

const source = new EventSource(url.toString())

source.addEventListener('transcription.chunk', (e) => {
  const data = JSON.parse(e.data)
  console.log(`${data.speaker}: ${data.text}`)
})

source.addEventListener('response.generated', (e) => {
  const data = JSON.parse(e.data)
  console.log(`Agent responded: ${data.text} (${data.latencyMs}ms)`)
})

source.addEventListener('reconnect', () => {
  console.log('Server shutting down, will auto-reconnect')
})

source.onerror = () => {
  console.log('Connection lost, EventSource will retry in 3s')
}
```

---

## TypeScript Type Definitions

All payload types consolidated for client-side use:

```typescript
// ---------------------------------------------------------------------------
// Agent Status (FSM states)
// ---------------------------------------------------------------------------

type AgentStatus =
  | 'disconnected'
  | 'launching'
  | 'authenticating'
  | 'connected'
  | 'joining'
  | 'listening'
  | 'idle'
  | 'processing'
  | 'speaking'
  | 'leaving'
  | 'space-ended'
  | 'error'

// ---------------------------------------------------------------------------
// /space namespace — Server-to-Client event map
// ---------------------------------------------------------------------------

interface SpaceMessage {
  id: string
  agentId: number
  name: string
  text: string
  timestamp: number
  isUser?: boolean
}

interface ServerToClientEvents {
  stateUpdate: (payload: { status: AgentStatus; spaceUrl: string | null }) => void
  messageHistory: (messages: SpaceMessage[]) => void
  health: (payload: { status: AgentStatus; uptime: number; timestamp: number }) => void
  'state:change': (payload: { from: string; to: string; event: string; timestamp: number }) => void
  xSpacesStatus: (payload: { status: AgentStatus | 'space-ended'; spaceUrl?: string | null }) => void
  textComplete: (message: SpaceMessage) => void
  'audio:level': (payload: { level: number; speaking: boolean; timestamp: number }) => void
  'audio:webrtc-stats': (payload: {
    inboundBitrate: number
    outboundBitrate: number
    roundTripTime: number
    packetLoss: number
    jitter: number
    timestamp: number
  }) => void
  'turn:decision': (payload: {
    shouldRespond: boolean
    confidence: number
    reason: string
    signals: {
      directlyAddressed: boolean
      isQuestion: boolean
      topicRelevance: number
      silenceDuration: number
    }
    timestamp: number
  }) => void
  'provider:status': (payload: {
    provider: string
    ok: boolean
    latencyMs: number
    error?: string
    timestamp: number
  }) => void
  'provider:cost': (payload: {
    provider: string
    lastCostUsd: number
    totalCost: number
    breakdown?: { llm: number; stt: number; tts: number }
    timestamp: number
  }) => void
  'selectors:health': (payload: {
    total: number
    healthy: number
    broken: number
    failures: Array<{ name: string; strategies: string[]; error: string }>
    timestamp: number
  }) => void
  'circuit:state-change': (payload: {
    provider: string
    from: 'closed' | 'open' | 'half-open'
    to: 'closed' | 'open' | 'half-open'
    failureCount: number
    timestamp: number
  }) => void
  'orchestrator:bot-status': (payload: {
    botId: string
    status: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'
    message?: string
    timestamp: number
  }) => void
  'orchestrator:speaking': (payload: {
    botId: string | null
    text?: string
    timestamp: number
  }) => void
  xSpacesError: (payload: { error: string }) => void
  log: (payload: {
    level: 'info' | 'warn' | 'error' | 'debug'
    message: string
    timestamp: number
    context?: Record<string, unknown>
  }) => void
}

// ---------------------------------------------------------------------------
// /space namespace — Client-to-Server event map
// ---------------------------------------------------------------------------

interface ClientToServerEvents {
  'xspace:start': (payload: { spaceUrl: string }) => void
  'xspace:stop': () => void
  'xspace:join': (payload: { spaceUrl: string }) => void
  'xspace:leave': () => void
  'xspace:2fa': (payload: { code: string }) => void
  'xspace:status': () => void
  'orchestrator:force-speak': (payload: { botId: string }) => void
  'admin:override-selector': (payload: { name: string; selector: string }) => void
}

// ---------------------------------------------------------------------------
// /events namespace — Event streaming types
// ---------------------------------------------------------------------------

interface EventEnvelope {
  id: string
  timestamp: string
  orgId: string
  event: StreamEvent
}

interface EventFilter {
  events?: string[]
  sessions?: string[]
  agents?: string[]
}

interface EventsClientToServer {
  subscribe: (filter: EventFilter, ack?: (resp: { ok: boolean; subscriptionId?: string; error?: string }) => void) => void
  unsubscribe: (filter: EventFilter, ack?: (resp: { ok: boolean }) => void) => void
  replay: (opts: { sessionId?: string; sinceEventId?: string; limit?: number }, ack?: (events: EventEnvelope[]) => void) => void
}

interface EventsServerToClient {
  event: (envelope: EventEnvelope) => void
  error: (payload: { message: string }) => void
}
```

### Usage with Typed Socket.IO Client

```typescript
import { io, Socket } from 'socket.io-client'

// Typed socket for the /space namespace
const spaceSocket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  'http://localhost:3000/space',
  { auth: { apiKey: process.env.ADMIN_API_KEY } },
)

spaceSocket.on('state:change', ({ from, to, event, timestamp }) => {
  console.log(`FSM: ${from} -> ${to} (${event})`)
})

spaceSocket.on('textComplete', (msg) => {
  const prefix = msg.isUser ? msg.name : 'Agent'
  console.log(`[${prefix}] ${msg.text}`)
})

// Typed socket for the /events namespace
const eventsSocket: Socket<EventsServerToClient, EventsClientToServer> = io(
  'http://localhost:3000/events',
  { auth: { apiKey: process.env.ADMIN_API_KEY } },
)

eventsSocket.emit('subscribe', { events: ['transcription.*'] }, (ack) => {
  if (ack.ok) console.log('Subscribed:', ack.subscriptionId)
})

eventsSocket.on('event', (envelope) => {
  console.log(`[${envelope.event.type}]`, envelope.event.data)
})
```


