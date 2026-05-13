# Prompt: Conversation Persistence & Replay

## Problem
When the server restarts, all conversation history is lost. There's no way to review past Space conversations, analyze agent performance, or replay interesting exchanges.

## Goal
Persist conversations to disk, provide a history browser in the admin panel, and support conversation replay.

## Current State
Conversations are stored in-memory only:
```js
spaceState.agents[0].conversationHistory = [
  { role: 'user', content: '...' },
  { role: 'assistant', content: '...' }
]
```
When the server restarts or the Space ends, this is gone.

## Design

### Storage Format
Each Space session gets a JSON file:
```
conversations/
├── 2026-03-23_crypto-space_1a2b3c.json
├── 2026-03-22_tech-talk_4d5e6f.json
└── index.json    ← lightweight index of all conversations
```

### Conversation Record Schema
```json
{
  "id": "1a2b3c",
  "spaceUrl": "https://x.com/i/spaces/...",
  "startedAt": "2026-03-23T14:00:00Z",
  "endedAt": "2026-03-23T15:30:00Z",
  "duration": 5400,
  "agents": [
    { "id": 0, "name": "Bob", "personality": "crypto-degen", "provider": "claude" },
    { "id": 1, "name": "Alice", "personality": "tech-analyst", "provider": "groq" }
  ],
  "stats": {
    "totalMessages": 142,
    "agentMessages": [78, 64],
    "userMessages": 12,
    "avgResponseTimeMs": 2340
  },
  "messages": [
    {
      "timestamp": "2026-03-23T14:02:15Z",
      "role": "user",
      "speaker": "@cryptodude",
      "content": "What do you think about the ETH merge?",
      "metadata": {
        "sttLatencyMs": 450,
        "source": "space-audio"
      }
    },
    {
      "timestamp": "2026-03-23T14:02:19Z",
      "role": "assistant",
      "agentId": 0,
      "agentName": "Bob",
      "content": "The merge was the most bullish event in crypto history...",
      "metadata": {
        "llmLatencyMs": 890,
        "ttsLatencyMs": 1200,
        "tokensUsed": 45,
        "model": "claude-sonnet-4-20250514"
      }
    }
  ]
}
```

### Implementation Modules

```
persistence/
├── recorder.js        ← Records messages during live session
├── storage.js         ← Read/write conversation files
├── index-manager.js   ← Maintains lightweight index for fast listing
└── replay.js          ← Replays conversation with timing
```

#### recorder.js
- Hooks into the existing message flow (handleLLMResponse, text events)
- Buffers messages and flushes to disk periodically (every 30s or 10 messages)
- On Space leave/disconnect, finalizes the conversation file
- Captures metadata: latencies, token usage, speaker info

#### storage.js
```js
class ConversationStorage {
  save(conversation)              // Write conversation to disk
  load(conversationId)            // Load full conversation
  list({ limit, offset, search }) // List conversations with pagination
  delete(conversationId)          // Delete a conversation
  getStats(conversationId)        // Get aggregate stats
  exportAsText(conversationId)    // Export as readable transcript
}
```

#### replay.js
Replays a conversation with original timing:
```js
class ConversationReplay {
  start(conversationId, socket)   // Start replay, emit messages with delays
  pause()
  resume()
  setSpeed(multiplier)            // 1x, 2x, 4x playback speed
  seekTo(messageIndex)            // Jump to specific point
}
```

### Admin UI — History Browser

New section in admin panel:

```
┌─ CONVERSATION HISTORY ───────────────────────┐
│                                               │
│  Search: [________________] [Filter ▼]        │
│                                               │
│  ┌─ Mar 23, 2026 ─ crypto-space ────────────┐│
│  │ Duration: 1h 30m | Messages: 142          ││
│  │ Agents: Bob (Claude), Alice (Groq)         ││
│  │ [View Transcript] [Replay] [Export] [Delete]│
│  └───────────────────────────────────────────┘│
│                                               │
│  ┌─ Mar 22, 2026 ─ tech-talk ───────────────┐│
│  │ Duration: 45m | Messages: 67              ││
│  │ Agents: Bob (OpenAI)                      ││
│  │ [View Transcript] [Replay] [Export] [Delete]│
│  └───────────────────────────────────────────┘│
│                                               │
│  Showing 1-10 of 23 conversations  [< >]      │
└───────────────────────────────────────────────┘
```

### Transcript View
```
┌─ TRANSCRIPT: crypto-space (Mar 23) ──────────┐
│                                               │
│  14:02:15 @cryptodude (Space):                │
│  "What do you think about the ETH merge?"     │
│                                               │
│  14:02:19 Bob (Claude, 890ms):                │
│  "The merge was the most bullish event..."    │
│                                               │
│  14:02:35 Alice (Groq, 340ms):                 │
│  "From a technical perspective though..."     │
│                                               │
│  [Export .txt] [Export .json] [Replay ▶]       │
└───────────────────────────────────────────────┘
```

### API Endpoints
```
GET    /api/conversations                → list conversations (paginated)
GET    /api/conversations/:id            → get full conversation
GET    /api/conversations/:id/transcript → get text transcript
DELETE /api/conversations/:id            → delete conversation
POST   /api/conversations/:id/replay     → start replay via Socket.IO
GET    /api/conversations/stats          → aggregate stats across all conversations
```

### Storage Limits
```env
MAX_CONVERSATIONS=100           # Max stored conversations (oldest auto-deleted)
MAX_CONVERSATION_SIZE_MB=10     # Max single conversation file size
CONVERSATION_DIR=./conversations # Storage directory
```

## Implementation Steps
1. Create storage module (read/write JSON files)
2. Create recorder that hooks into message flow
3. Add auto-save on Space leave/disconnect
4. Build API endpoints
5. Build admin UI history browser
6. Add transcript view
7. Add replay functionality
8. Add export (text/JSON)

## Validation
- [ ] Messages are recorded during live Space session
- [ ] Conversation file is saved when Space ends
- [ ] Server restart preserves all conversation files
- [ ] Admin can browse past conversations
- [ ] Transcript view shows all messages with timestamps
- [ ] Export produces readable text file
- [ ] Replay emits messages with correct timing
- [ ] Old conversations are auto-cleaned when limit reached


