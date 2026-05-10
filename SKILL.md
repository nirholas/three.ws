---
name: three-ws
description: Build, deploy, and control AI agents with 3D bodies on three.ws. Create agents, upload GLB/glTF models, wire a talking avatar into any web page, manage persistent agent memory, and prepare onchain identity registration — all via REST API.
metadata:
  openclaw:
    requirements:
      env:
        - THREEWS_API_KEY
      optional_env:
        - THREEWS_AGENT_ID
---

# three.ws — Give Your AI a Body

three.ws turns AI agents into embodied 3D characters. Drop one script tag to embed a talking, gesturing avatar on any page. Create agents via API, upload custom GLB models, and optionally anchor your agent to an onchain identity (EVM or Solana).

**Base URL:** `https://three.ws`  
**Auth:** `Authorization: Bearer $THREEWS_API_KEY`  
**Responses:** JSON throughout.

## Quick Start

```bash
# 1. Create an agent
curl -X POST https://three.ws/api/agents \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Aria",
    "instructions": "You are Aria, a helpful product assistant. Be concise and friendly.",
    "brain": "claude-sonnet-4-6"
  }'
# → { "id": "a_abc123", ... }

# 2. Embed on any page
echo '<script type="module" src="https://cdn.three.ws/agent-3d.js"></script>
<agent-3d agent-id="a_abc123" mode="floating" position="bottom-right"></agent-3d>'
```

## Skills in this package

| Skill | What it does |
|---|---|
| [create-agent](skills/create-agent/SKILL.md) | Create, list, and update 3D AI agents |
| [upload-model](skills/upload-model/SKILL.md) | Upload a GLB/glTF file and get a hosted URL |
| [agent-memory](skills/agent-memory/SKILL.md) | Read and write persistent agent memory entries |
| [onchain-identity](skills/onchain-identity/SKILL.md) | Prepare onchain identity registration (EVM + Solana) |

## Embedding the avatar

```html
<script type="module" src="https://cdn.three.ws/agent-3d.js"></script>

<!-- From an API agent id -->
<agent-3d agent-id="a_abc123" mode="floating" position="bottom-right"
          width="320px" height="480px" camera-controls></agent-3d>

<!-- Ad-hoc GLB (no agent required) -->
<agent-3d body="./my-character.glb" auto-rotate environment="city"></agent-3d>
```

Full attribute reference: [clawhub-skills/agent-3d/SKILL.md](clawhub-skills/agent-3d/SKILL.md)

## Drive the avatar from JavaScript

```js
const iframe = document.querySelector('iframe');

// Make the avatar speak
iframe.contentWindow.postMessage(
  { v: 1, source: 'agent-host', kind: 'request', op: 'speak',
    payload: { text: 'Hello!', sentiment: 0.8 }, id: crypto.randomUUID() },
  '*'
);

// Trigger a gesture
iframe.contentWindow.postMessage(
  { v: 1, source: 'agent-host', kind: 'request', op: 'gesture',
    payload: { name: 'wave' }, id: crypto.randomUUID() },
  '*'
);
```

Gestures: `wave`, `celebrate`, `shrug`, `nod`, `point`, `bow`  
Emotes: `curiosity`, `celebration`, `patience`, `concern`, `joy`, `neutral`

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/agents` | GET | List your agents |
| `/api/agents` | POST | Create an agent |
| `/api/agents/:id` | GET | Get one agent (public) |
| `/api/agents/:id` | PUT | Update agent (owner) |
| `/api/avatars/presign` | POST | Get a signed upload URL for a GLB/glTF |
| `/api/avatars` | POST | Register an uploaded model |
| `/api/avatars` | GET | List your models |
| `/api/agent-memory` | GET | Fetch agent memories |
| `/api/agent-memory` | POST | Store a memory entry |
| `/api/agent-memory/:id` | DELETE | Forget a memory |
| `/api/agents/onchain/prep` | POST | Prepare an onchain registration transaction |
| `/api/agents/onchain/confirm` | POST | Confirm after the user's wallet signs |
