> **Internal Planning Document** — Not part of the public documentation.

# Prompt: Agent Personality & Configuration Editor

## Problem
Agent configuration (system prompts, voices, names, avatars) is currently hardcoded in `server.js` and environment variables. Changing an agent's personality requires editing code and restarting the server.

## Goal
A visual editor in the admin panel where you can create, edit, and hot-swap agent personalities without restarting.

## Current State
```js
// server.js - hardcoded agent config
agents: [
  {
    prompt: `You are Agent 0 named "Bob"...`,
    voice: process.env.ELEVENLABS_VOICE_0,
    conversationHistory: []
  },
  {
    prompt: `You are Agent 1 named "Alice"...`,
    voice: process.env.ELEVENLABS_VOICE_1,
    conversationHistory: []
  }
]
```

## Target: Agent Personality System

### Data Model
```json
// personalities/default-agent-0.json
{
  "id": "bob-crypto-degen",
  "name": "Bob",
  "description": "Crypto-savvy degen with strong opinions",
  "systemPrompt": "You are Bob, a crypto-native AI agent...",
  "voice": {
    "provider": "elevenlabs",
    "voiceId": "VR6AewLTigWG4xSOukaG",
    "speed": 1.0,
    "stability": 0.5
  },
  "avatar": "https://...",
  "behavior": {
    "maxResponseTokens": 150,
    "temperature": 0.8,
    "respondToChat": true,
    "autoConverse": true,
    "interruptible": false
  },
  "context": [
    "You are participating in an X Space about crypto.",
    "Keep responses under 2 sentences.",
    "Be opinionated but respectful."
  ]
}
```

### File Structure
```
personalities/
├── presets/                    ← Bundled personality templates
│   ├── crypto-degen.json
│   ├── tech-analyst.json
│   ├── comedian.json
│   ├── interviewer.json
│   └── educator.json
├── custom/                    ← User-created personalities (gitignored)
│   └── my-agent.json
└── index.js                   ← Loader: reads presets + custom, provides CRUD API
```

### Admin UI — Personality Editor
Add a new tab/section to admin.html:

```
┌─ AGENT CONFIGURATION ────────────────────────┐
│                                               │
│  Agent 0                    Agent 1           │
│  ┌─────────────────┐       ┌─────────────────┐│
│  │ Personality: [▼]│       │ Personality: [▼]││
│  │ ┌─ Bob (crypto) │       │ ┌─ Alice (tech)  ││
│  │ │  Tech Analyst  │       │ │  Comedian     ││
│  │ │  Comedian      │       │ │  Interviewer  ││
│  │ │  + New...      │       │ │  + New...     ││
│  │ └────────────────│       │ └───────────────││
│  │                  │       │                 ││
│  │ Name: [Bob     ] │       │ Name: [Alice   ] ││
│  │                  │       │                 ││
│  │ System Prompt:   │       │ System Prompt:  ││
│  │ ┌──────────────┐│       │ ┌──────────────┐││
│  │ │You are Bob...││       │ │You are Alice..│││
│  │ │              ││       │ │              │││
│  │ └──────────────┘│       │ └──────────────┘││
│  │                  │       │                 ││
│  │ Voice: [▼ EL-xx]│       │ Voice: [▼ EL-yy]││
│  │ Temp:  [0.8═══] │       │ Temp:  [0.7═══] ││
│  │ Max tokens: [150]│       │ Max tokens: [150]││
│  │                  │       │                 ││
│  │ [Save] [Reset]   │       │ [Save] [Reset]  ││
│  └─────────────────┘       └─────────────────┘│
│                                               │
│  [Apply Changes] (hot-swap without restart)   │
└───────────────────────────────────────────────┘
```

### Server API Endpoints
```
GET    /api/personalities              → list all available personalities
GET    /api/personalities/:id          → get one personality
POST   /api/personalities              → create new personality
PUT    /api/personalities/:id          → update personality
DELETE /api/personalities/:id          → delete custom personality

POST   /api/agents/:agentId/personality → apply personality to agent (hot-swap)
GET    /api/agents/:agentId/personality → get agent's current personality
```

### Hot-Swap Implementation
When admin applies a new personality:
1. Server updates `spaceState.agents[agentId].prompt` with new system prompt
2. Server updates voice config for TTS
3. Conversation history is optionally cleared or kept
4. No restart needed — next LLM call uses new prompt
5. Socket event notifies dashboard of personality change

### Preset Personalities (Bundled Templates)

**Crypto Degen**: Bullish, uses crypto slang, references on-chain data
**Tech Analyst**: Measured, data-driven, explains technical concepts
**Comedian**: Quick wit, one-liners, roasts other speakers
**Interviewer**: Asks thoughtful questions, draws out speakers
**Educator**: Patient, explains complex topics simply, uses analogies

Each preset is a starting point that users can customize and save as their own.

## Implementation Steps
1. Create personality data model and JSON schema
2. Build personality loader (reads presets + custom dir)
3. Add API endpoints for CRUD operations
4. Add hot-swap logic to server (update agent state without restart)
5. Build admin UI personality editor
6. Create 5 preset personalities
7. Add "New personality" flow in admin UI

## Validation
- [ ] Personalities load from JSON files on startup
- [ ] Admin can switch personalities via UI
- [ ] Hot-swap works without restarting server
- [ ] Custom personalities persist across restarts
- [ ] Preset personalities can't be deleted (only custom ones)
- [ ] Voice changes take effect on next TTS call
- [ ] System prompt changes take effect on next LLM call


