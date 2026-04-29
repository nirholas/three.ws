> **Internal Planning Document** — Not part of the public documentation.

# Prompt: Multi-Space Support

## Problem
Currently the bot can only join one X Space at a time. The entire system is built around a single `spaceState` object and a single Puppeteer browser instance.

## Goal
Support joining **multiple X Spaces simultaneously**, each with independent agent configurations, audio pipelines, and conversation histories.

## Current Architecture (Single Space)
```
spaceState = {
  agents: [{prompt, voice, history}, {prompt, voice, history}],
  currentTurn: null,
  turnQueue: [],
  isProcessing: false,
  spaceUrl: null
}
```
One `xSpaces` instance → one browser → one Space → one audio bridge.

## Target Architecture (Multi-Space)

### Space Manager
New top-level module that manages multiple space instances:

```
space-manager/
├── index.js              ← SpaceManager class: create, list, remove spaces
├── space-instance.js     ← SpaceInstance: wraps xSpaces + state for one Space
└── instance-pool.js      ← Browser pool: reuse or limit Puppeteer instances
```

### SpaceManager API
```js
class SpaceManager {
  instances = new Map()  // spaceId → SpaceInstance

  create(spaceId, config)    // Create new space instance with config
  get(spaceId)               // Get instance by ID
  list()                     // List all active instances
  remove(spaceId)            // Leave Space and cleanup
  getStats()                 // Aggregate stats across all spaces
}
```

### SpaceInstance
Each instance is self-contained:
```js
class SpaceInstance {
  id          // unique identifier
  config      // agents, prompts, voices, provider
  state       // spaceState equivalent
  xSpaces     // x-spaces module instance
  turnManager // independent turn queue
  status      // disconnected, launching, speaking, etc.
}
```

### Key Design Decisions

**Browser instances:**
- Option A: One browser, multiple tabs (cheaper, but tabs share cookies/session)
- Option B: Separate browser per Space (isolated, but resource-heavy)
- **Recommendation: Option B** — X/Twitter session state is tab-global, and stealth plugins work better with isolated instances. Limit to 3-5 concurrent spaces via `MAX_SPACES` env var.

**Auth:**
- All spaces share the same X account (same cookies)
- Cookie file is shared but each browser loads its own copy
- If 2FA is needed, it blocks all pending space joins until resolved

**Socket.IO:**
- Admin panel gets a dropdown/list of spaces
- Each space gets a sub-room: `space:${spaceId}`
- Events are namespaced: `xspace:start:${spaceId}`, etc.
- Dashboard can switch between spaces or show all

### Admin Panel Changes
```
┌─ SPACE MANAGER ──────────────────────────────┐
│                                               │
│  [+ New Space]                                │
│                                               │
│  ┌─ Space: "crypto-chat" ──── Status: ● ───┐ │
│  │  URL: x.com/i/spaces/1abc...             │ │
│  │  Agents: 2 active | Mode: openai-chat    │ │
│  │  [Leave] [Configure] [View Dashboard]    │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌─ Space: "tech-talk" ────── Status: ● ───┐ │
│  │  URL: x.com/i/spaces/2def...             │ │
│  │  Agents: 1 active | Mode: claude         │ │
│  │  [Leave] [Configure] [View Dashboard]    │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  Bot Status: ● Running (2/5 spaces)           │
│  [Start Bot] [Stop All]                       │
└───────────────────────────────────────────────┘
```

### Per-Space Configuration
When creating a new space, admin can configure:
- Agent count (1 or 2)
- AI provider per agent
- System prompts per agent
- TTS voice per agent
- Auto-join URL (for scheduled joins)

### Resource Limits
```env
MAX_SPACES=5              # Maximum concurrent spaces
MAX_AGENTS_PER_SPACE=2    # Maximum agents per space
BROWSER_POOL_SIZE=5       # Maximum Puppeteer instances
```

## Implementation Steps
1. Refactor `spaceState` into a class (`SpaceInstance`)
2. Create `SpaceManager` that manages instances
3. Update x-spaces/ to accept instance-specific config instead of globals
4. Update Socket.IO handlers to route by spaceId
5. Update admin panel with space list UI
6. Add browser pool with resource limits
7. Update dashboard to switch between spaces

## Challenges
- **Memory**: Each Puppeteer instance uses ~200-300MB RAM. 5 spaces = 1-1.5GB
- **CPU**: Audio processing (VAD, PCM conversion) scales linearly
- **X rate limits**: Multiple spaces from one account might trigger rate limiting
- **Cookie conflicts**: Need separate cookie storage per browser instance if using different accounts

## Validation
- [ ] Can join 2+ Spaces simultaneously
- [ ] Each Space has independent conversation history
- [ ] Each Space has independent turn management
- [ ] Admin panel shows all active spaces
- [ ] Leaving one Space doesn't affect others
- [ ] MAX_SPACES limit is enforced
- [ ] Browser cleanup works when removing a space


