---
name: create-agent
description: >
  Create and configure a three.ws embodied 3D AI agent via the REST API.
  Covers creating the agent record, setting name/description/skills, linking
  an avatar GLB, and retrieving agent details. Uses https://three.ws/api/agents.
metadata:
  author: three.ws
  version: "1.0"
---

# Create a three.ws Agent

Use this skill when the user wants to create a new agent on the three.ws platform, update an existing agent's metadata, or list their agents.

## Authentication

All write operations require a Bearer token. Direct the user to generate one at **https://three.ws/settings/api-keys** with scope `avatars:read avatars:write`.

```
Authorization: Bearer <token>
```

## Create an agent

`POST https://three.ws/api/agents`

**Request body:**

```json
{
  "name": "Coach Leo",
  "description": "A football coach who reviews your form and motivates you.",
  "skills": ["greet", "present-model", "remember", "think"]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | 1–100 chars |
| `description` | string | no | up to 500 chars |
| `skills` | string[] | no | defaults to `["greet","present-model","validate-model","remember","think"]` |
| `meta` | object | no | freeform JSON merged into agent metadata |

**Response (201):**

```json
{
  "agent": {
    "id": "a_01hx...",
    "name": "Coach Leo",
    "description": "A football coach who reviews your form and motivates you.",
    "skills": ["greet", "present-model", "remember", "think"],
    "walletAddress": "0xabc...",
    "homeUrl": "/agent/a_01hx...",
    "createdAt": "2026-05-10T00:00:00.000Z"
  }
}
```

The platform automatically provisions an EVM wallet and a Solana wallet for every new agent. The `walletAddress` is the EVM address.

## List agents

`GET https://three.ws/api/agents`

Returns all agents owned by the authenticated user. Pass `?onchain=true` to filter to on-chain registered agents only.

## Get one agent

`GET https://three.ws/api/agents/<id>`

Returns full agent record if the caller is the owner; returns public fields only for other agents.

## Get or auto-create default agent

`GET https://three.ws/api/agents/me`

Creates the caller's first agent automatically if none exists. Safe to call on every page load — idempotent.

## Update an agent

`PUT https://three.ws/api/agents/<id>`

Same shape as the create body. Only the fields you send are updated.

## Built-in skill names

The following skill identifiers are understood by the three.ws runtime. All are enabled by default unless overridden.

**Core:**

| Skill | What it does |
|-------|-------------|
| `greet` | First-meet greeting and intro sequence (animation: wave) |
| `present-model` | Traverses the loaded GLB — counts vertices, meshes, materials, clips — then narrates (animation: present) |
| `validate-model` | Runs the glTF validator and speaks results (animation: inspect) |
| `remember` | Stores a fact into persistent agent memory (animation: nod) |
| `think` | Extended thinking mode before responding (animation: think) |
| `sign-action` | Signs an agent action with its EVM wallet for provenance (animation: sign) |
| `help` | Lists the agent's available skills |

**3D scene manipulation** (add any of these to `skills`):

| Skill | What it does |
|-------|-------------|
| `scene-create-object` | Creates a box, sphere, cone, or cylinder in the Three.js scene with color and position |
| `scene-find-object` | Finds an object in the scene by name |
| `scene-update-object` | Moves, re-colors, or rescales an existing scene object |
| `analyze-sentiment` | Analyzes sentiment in text and drives avatar emote intensity |

## Linking an avatar GLB

After creating an agent, attach a body by either:

1. **Uploading to three.ws** — use the avatar upload UI at `https://three.ws/create` and note the avatar UUID returned.
2. **Providing an IPFS URI** — put the GLB at `ipfs://<CID>/body.glb` and set it in the manifest (see `agent-manifest` skill).
3. **PUT the avatarId field:**

```json
PUT https://three.ws/api/agents/<id>
{ "meta": { "avatarId": "<uuid>" } }
```

## Error reference

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `validation_error` | Missing or malformed field |
| 401 | `unauthorized` | Token missing or expired |
| 403 | `insufficient_scope` | Token needs `avatars:write` |
| 429 | `rate_limited` | Slow down — back off and retry |

## Example: create and immediately update

```js
const BASE = 'https://three.ws';
const TOKEN = process.env.THREEWS_API_TOKEN;

const { agent } = await fetch(`${BASE}/api/agents`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Coach Leo', description: 'Football coach' }),
}).then(r => r.json());

console.log('Created agent:', agent.id, agent.walletAddress);

// Add a skill
await fetch(`${BASE}/api/agents/${agent.id}`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ skills: ['greet', 'present-model', 'remember', 'think', 'watch-pump'] }),
}).then(r => r.json());
```
