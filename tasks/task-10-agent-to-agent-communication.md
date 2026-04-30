# Task: Agent-to-Agent Communication via Skills

## Context

This is the `three.ws` 3D agent platform. Agents execute skills via `src/agent-skills.js`. Each skill handler receives a context object `ctx` with helpers like `ctx.speak()`, `ctx.remember()`, `ctx.fetch()`. Currently, there is no way for one agent to delegate work to another agent programmatically.

The event bus (`src/agent-protocol.js`) is local to a single `<agent-3d>` element. The backend has agent data via `GET /api/agents/:id`. The MCP server (`api/mcp.js`) already has a `search_public_avatars` tool.

## Goal

Add `ctx.call(agentId, message)` to the skill execution context so skills can send a message to another agent and receive its response. This enables delegation: a user-facing agent can hand off specialized tasks (e.g., a trading agent calling a research agent).

## What to Build

### 1. Backend endpoint: `api/agent-delegate.js` (new file)

`POST /api/agent-delegate`

- Auth: bearer with any valid scope (agent-to-agent calls are authenticated as the calling agent's session)
- Body: `{ fromAgentId, toAgentId, message, context? }`
- Looks up `toAgentId` in the DB, loads its manifest (system prompt, model config)
- Runs a single LLM turn: sends `message` to the target agent's configured Claude model with the target agent's system prompt
- Returns `{ response: string, agentId: toAgentId }`
- Rate limit: 10 delegate calls per agent per minute (use existing `limits` helper)
- Do not recurse: if the delegated turn itself tries to call `agent-delegate`, reject with 400

### 2. Add `ctx.call()` to `src/agent-skills.js`

In the skill context builder (wherever `ctx` is assembled), add:

```js
ctx.call = async (agentId, message) => {
  const res = await fetch('/api/agent-delegate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ fromAgentId: currentAgentId, toAgentId: agentId, message })
  })
  if (!res.ok) throw new Error(`Delegate call failed: ${res.status}`)
  const { response } = await res.json()
  return response
}
```

### 3. Add `call_agent` to the MCP tool catalog (`api/mcp.js`)

Add a new MCP tool so external AI systems can also use agent-to-agent delegation:

```json
{
  "name": "call_agent",
  "description": "Send a message to another three.ws agent and get its response. Use this to delegate specialized tasks.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "agent_id": { "type": "string", "description": "The agent's ID" },
      "message": { "type": "string", "description": "The message to send" }
    },
    "required": ["agent_id", "message"]
  }
}
```

Scope required: `avatars:read`. Implementation: call `POST /api/agent-delegate` internally.

## Constraints

- No recursion: the delegate endpoint must check for a `X-Delegate-Depth` header and reject if depth > 0
- The delegated agent uses its own system prompt and model config — not the calling agent's
- Do not stream the delegate response — return it as a complete string
- `api/agent-delegate.js` should be ≤ 80 lines

## Success Criteria

- A skill can call `await ctx.call('agent-id-123', 'What is the market cap of SOL?')` and receive a string response
- The MCP `call_agent` tool works via `POST /api/mcp`
- Recursive delegation (A → B → A) is rejected with a clear error
- Rate limiting is enforced (11th call within a minute returns 429)
