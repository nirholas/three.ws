# Rooms

Rooms provide isolated conversation spaces so multiple users can have independent voice chat sessions on the same server.

## How Rooms Work

Each room has its own:
- **Conversation history** — messages are scoped to the room
- **Turn queue** — agents take turns within each room independently
- **Agent state** — connection status is tracked per room
- **Client list** — tracks which Socket.IO connections belong to which room

Without rooms, all users share a single global conversation. With rooms, each user (or group) gets a private session.

## Default Behavior

If no room is specified, clients join the `"default"` room. This works fine for single-user or demo deployments.

## Creating Rooms

### Via Socket.IO

Clients specify a room when connecting:

```javascript
const socket = io('http://localhost:3000/space');

socket.emit('joinRoom', {
  roomId: 'support-session-abc123',
  agentId: 0
});
```

If the room doesn't exist, it's created automatically.

### Via REST API

```bash
# Create a room with custom configuration
curl -X POST http://localhost:3000/api/rooms \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "support-session-abc123",
    "config": {
      "agentIds": [0, 1],
      "maxParticipants": 10,
      "ttlMinutes": 60,
      "isPublic": false
    }
  }'
```

### Room Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agentIds` | number[] | `[0, 1]` | Which agents are available in this room |
| `maxParticipants` | number | `50` | Max simultaneous client connections |
| `ttlMinutes` | number | `30` | Minutes before empty room is auto-deleted |
| `isPublic` | boolean | `true` | Whether the room appears in room listings |

## Listing Rooms

```bash
curl http://localhost:3000/api/rooms
```

Response:

```json
[
  {
    "id": "default",
    "clients": 2,
    "agents": { "0": { "name": "Bob", "connected": true } },
    "createdAt": "2026-03-23T10:00:00Z",
    "lastActivity": "2026-03-23T10:05:00Z"
  },
  {
    "id": "support-session-abc123",
    "clients": 1,
    "agents": { "0": { "name": "Bob", "connected": true } },
    "createdAt": "2026-03-23T10:02:00Z",
    "lastActivity": "2026-03-23T10:04:00Z"
  }
]
```

## Deleting Rooms

```bash
curl -X DELETE http://localhost:3000/api/rooms/support-session-abc123
```

The `"default"` room cannot be deleted.

## Auto-Cleanup

Empty rooms are automatically deleted after their TTL expires (default: 30 minutes). The cleanup runs every 5 minutes. The `"default"` room is exempt from auto-cleanup.

## Multi-Tenancy Patterns

### Per-User Sessions

Give each user their own room:

```javascript
// Client
const roomId = `user-${userId}`;
socket.emit('joinRoom', { roomId, agentId: 0 });
```

Each user gets a private conversation with the agent. Conversation history is isolated.

### Per-Session Rooms

Create a room for each support ticket or session:

```javascript
const roomId = `ticket-${ticketId}`;

AgentVoiceChat.init({
  server: 'https://your-server.com',
  agent: 'support',
  room: roomId
});
```

### Shared Group Rooms

Multiple users can join the same room for a group conversation:

```javascript
// All users join the same room
const roomId = 'team-standup';
socket.emit('joinRoom', { roomId, agentId: 0 });
```

Everyone in the room hears the same conversation and takes turns speaking.

## Room State

Each room maintains this state:

```javascript
{
  id: "room-id",
  agents: {
    0: { id: 0, name: "Bob", status: "idle", connected: true },
    1: { id: 1, name: "Alice", status: "idle", connected: false }
  },
  currentTurn: null,    // Which agent is speaking
  turnQueue: [],         // Agents waiting to speak
  messages: [],          // Conversation history
  isProcessing: false,   // Whether an LLM request is in progress
  clients: Set(),        // Connected socket IDs
  config: {
    ttlMinutes: 30,
    maxParticipants: 50
  }
}
```

## Widget Integration

Pass the room ID to the widget:

```html
<script
  src="https://unpkg.com/agent-voice-chat/widget.js"
  data-server="https://your-server.com"
  data-agent="bob"
  data-room="support-session-abc123"
></script>
```

Or programmatically:

```javascript
AgentVoiceChat.init({
  server: 'https://your-server.com',
  agent: 'bob',
  room: `session-${sessionId}`
});
```


