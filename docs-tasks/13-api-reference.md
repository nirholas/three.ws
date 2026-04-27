# Agent Task: Write "API Reference" Documentation

## Output file
`public/docs/api-reference.md`

## Target audience
Developers integrating with the three.ws platform programmatically — fetching agents, managing widgets, posting memory, or using the LLM proxy. This is a REST API reference.

## Word count
2500–3500 words (this is a large reference doc)

## What this document must cover

### 1. Overview
Base URL: `https://three.ws/api`

Authentication: Bearer token (API key) or session cookie.
```
Authorization: Bearer 3da_live_xxxxx
```

Response format: JSON. Errors follow:
```json
{ "error": "Message describing what went wrong", "code": "ERROR_CODE" }
```

Rate limits: 100 req/min for authenticated, 20 req/min for unauthenticated.

### 2. Agents API

**GET /api/agents**
List all public agents (paginated).
```
GET /api/agents?limit=20&offset=0&sort=created_at&order=desc
```
Response:
```json
{
  "agents": [
    {
      "id": "abc123",
      "name": "Aria",
      "description": "Product guide",
      "avatar_url": "https://cdn..../aria.glb",
      "thumbnail_url": "https://cdn..../aria.png",
      "creator_address": "0x...",
      "created_at": "2025-01-15T10:00:00Z",
      "chain_id": 8453,
      "chain_agent_id": 42,
      "reputation": { "average": 4.8, "count": 23 }
    }
  ],
  "total": 142,
  "limit": 20,
  "offset": 0
}
```

**GET /api/agents/:id**
Get a single agent by platform ID.
```
GET /api/agents/abc123
```

**POST /api/agents** (auth required)
Create a new agent.
```json
{
  "name": "Aria",
  "description": "Product guide",
  "manifest": { ... }
}
```
Response: `{ "id": "new-agent-id", "agent": { ... } }`

**PUT /api/agents/:id** (auth required, owner only)
Update agent metadata or manifest.

**DELETE /api/agents/:id** (auth required, owner only)
Delete agent from platform (does not affect on-chain registration).

**GET /api/agents/by-address/:address**
Get all agents owned by an Ethereum address.

**GET /api/agents/ens/:name**
Resolve agent by ENS name (e.g., `myagent.eth`).

### 3. Widgets API

**GET /api/widgets**
List all public widgets.
```
GET /api/widgets?limit=20&offset=0&type=turntable
```

Query params:
- `type` — filter by widget type
- `agent_id` — filter by agent ID
- `sort`, `order` — sorting

**GET /api/widgets/:id**
Get a widget by ID.

**POST /api/widgets** (auth required)
Create a new widget.
```json
{
  "agent_id": "abc123",
  "type": "turntable",
  "config": {
    "auto_rotate_speed": 0.5,
    "preset": "venice"
  },
  "visibility": "public"
}
```
Response: `{ "id": "widget-id", "embed_url": "https://three.ws/widgets/view?id=..." }`

**PUT /api/widgets/:id** (auth required, owner only)
Update widget config.

**DELETE /api/widgets/:id** (auth required, owner only)
Delete widget.

**GET /api/widgets/og**
Open Graph metadata for widget (used by social preview scrapers).
```
GET /api/widgets/og?id=widget-id
```

**GET /api/widgets/oembed**
oEmbed endpoint for rich embeds in Notion, Substack, etc.
```
GET /api/widgets/oembed?url=https://three.ws/widgets/view?id=widget-id
```

### 4. Agent Actions API

**POST /api/agent-actions** (fire-and-forget)
Log an agent action (used internally by the agent identity system).
```json
{
  "agent_id": "abc123",
  "action": "speak",
  "payload": { "text": "Hello, welcome!" },
  "signature": "0x...",
  "timestamp": "2025-01-15T10:05:00Z"
}
```
Response: `{ "ok": true }` (non-blocking, best-effort)

**GET /api/agent-memory**
Load agent memory files.
```
GET /api/agent-memory?agent_id=abc123&type=long-term
```

### 5. Chat / LLM API

**POST /api/chat**
Send a message to an agent's LLM runtime. Proxied through the platform for auth and rate limiting.
```json
{
  "agent_id": "abc123",
  "messages": [
    { "role": "user", "content": "What animations do you have?" }
  ],
  "context": {
    "model_name": "avatar.glb",
    "animations": ["wave", "idle", "dance"]
  }
}
```
Response (streaming):
```
data: {"type": "content", "text": "I have three animations..."}
data: {"type": "tool_call", "name": "play_clip", "args": {"name": "wave"}}
data: {"type": "done"}
```

**POST /api/llm/anthropic**
Direct proxy to Anthropic Claude API (requires auth + API key configured).
Same request/response format as the Anthropic Messages API.

### 6. TTS API

**POST /api/tts/eleven**
Text-to-speech via ElevenLabs.
```json
{
  "text": "Hello, welcome to my portfolio!",
  "voice_id": "rachel",
  "model_id": "eleven_monolingual_v1"
}
```
Response: Audio binary (MP3). `Content-Type: audio/mpeg`.

### 7. Authentication API
(Detailed in Authentication documentation — brief reference here)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/siwe/nonce` | GET | Get SIWE nonce |
| `/api/auth/siwe/verify` | POST | Verify SIWE signature |
| `/api/auth/session` | GET | Get current session |
| `/api/auth/session` | DELETE | Logout |
| `/api/auth/privy/[handler]` | GET/POST | Privy OAuth |
| `/api/auth/wallets` | GET | List linked wallets |
| `/api/auth/wallets` | POST | Link new wallet |

### 8. API Keys API

**GET /api/api-keys** (auth required)
List API keys for current user.

**POST /api/api-keys** (auth required)
Create new API key.
```json
{ "name": "My Integration", "scopes": ["agents:read", "widgets:write"] }
```
Response: `{ "id": "key-id", "key": "3da_live_xxxxx" }` — key shown only once!

**DELETE /api/api-keys/:id** (auth required)
Revoke an API key.

### 9. Discovery / Explore API

**GET /api/explore**
Search and filter agents for discovery.
```
GET /api/explore?q=fitness+coach&tags=health&sort=reputation
```

**GET /api/showcase**
Get featured/curated agents for the homepage.

### 10. ERC-8004 API

**GET /api/erc8004/:chainId/:agentId**
Resolve an on-chain agent to its manifest.
Returns the full agent manifest JSON.

**GET /api/a-page**
Render the on-chain agent page (`/a/<chainId>/<agentId>`).

### 11. MCP API

**POST /api/mcp**
Model Context Protocol endpoint — allows Claude and other MCP-compatible clients to interact with three.ws as a tool server.

See MCP documentation for full details.

### 12. Config API

**GET /api/config**
Get public platform configuration (feature flags, supported chains, version).
```json
{
  "version": "1.5.1",
  "chains": [1, 8453, 11155111],
  "features": {
    "ipfsMemory": true,
    "voiceInput": true,
    "ar": true
  }
}
```

### 13. Error codes reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `FORBIDDEN` | 403 | Authenticated but not allowed |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `RATE_LIMITED` | 429 | Too many requests |
| `INVALID_INPUT` | 400 | Request body validation failed |
| `AGENT_NOT_FOUND` | 404 | Agent ID not found |
| `WIDGET_NOT_FOUND` | 404 | Widget ID not found |
| `CHAIN_NOT_SUPPORTED` | 400 | chainId not in supported list |
| `IPFS_FAILED` | 503 | IPFS pinning service unavailable |
| `LLM_ERROR` | 502 | LLM provider error |

### 14. Pagination
All list endpoints support cursor or offset pagination:
```
GET /api/agents?limit=20&offset=40
```
Response always includes `total`, `limit`, `offset`.

### 15. SDK usage
Instead of raw HTTP, use the SDK:
```js
import { AgentAPI } from '@3dagent/sdk';
const api = new AgentAPI({ apiKey: '3da_live_xxxxx' });

const agents = await api.agents.list({ limit: 10 });
const agent = await api.agents.get('abc123');
const widget = await api.widgets.create({ agentId: 'abc123', type: 'turntable' });
```

## Tone
Classic API reference documentation. Terse descriptions, complete examples, tables for parameters and error codes. Every endpoint gets a request example and response example.

## Files to read for accuracy
- `/api/agents.js`
- `/api/agents/[id].js`
- `/api/widgets/index.js`
- `/api/widgets/[id].js`
- `/api/chat.js`
- `/api/llm/anthropic.js`
- `/api/tts/eleven.js`
- `/api/agent-actions.js`
- `/api/agent-memory.js`
- `/api/api-keys/index.js`
- `/api/explore.js`
- `/api/showcase.js`
- `/api/config.js`
- `/api/mcp.js`
- `/docs/API.md`
- `/docs/api-inventory.md`
