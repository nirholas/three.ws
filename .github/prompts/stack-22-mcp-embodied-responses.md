---
mode: agent
description: 'MCP tools that return embodied agent renderings, not just text'
---

# Stack Layer 5: MCP Tools Return Embodied Responses

## Problem

[api/mcp.js](api/mcp.js) currently exposes CRUD tools (list/get/validate). To move up the stack, the MCP server should return tool results that _contain_ an embodied agent render — so Claude.ai, Cursor, and other MCP clients can display the agent, not just text.

## Implementation

### New / updated tools

- `summon_agent` — args: `{ slug, skill?, input? }` → returns:
    ```json
    {
    	"content": [
    		{ "type": "text", "text": "Agent Satoshi responded: 'Hello'" },
    		{
    			"type": "resource",
    			"resource": {
    				"uri": "https://three.ws/agent/satoshi?kiosk=1&skill=greet",
    				"mimeType": "text/html"
    			}
    		}
    	]
    }
    ```
- `describe_agent` — `{ slug }` → identity, skills, recent public actions, onchain status.
- `render_agent_artifact` — `{ slug }` → returns a self-contained HTML artifact payload (see stack-19).
- `invoke_skill` — `{ slug, skill, input }` → runs skill server-side, returns text + optional embed URL.

### Embed URL vs artifact

- For MCP clients that support HTML resource rendering (Claude Desktop, some others) → return the embed URL.
- For clients that only render text (ChatGPT-style) → return a descriptive text block + a link.

### Server-side skill execution

For `invoke_skill`, we need a headless runner. Options:

1. **Pure logic skills** (memory write, identity query) — run directly in the API.
2. **Presentation skills** (greet, celebrate) — don't execute server-side; just return an embed URL that auto-plays the skill via `?skill=<id>` on load.

Split skills into `pure` and `presentational` in their manifest.

### Auth

- Public avatars: any MCP caller can summon/describe.
- Private skills or owner-only: require a three.ws API key via Bearer (already in [api/keys/](api/keys/)).

### Tool descriptions

Each tool's description should tell Claude when to use it ("Use `summon_agent` when the user references a three.ws by slug or wants to see an embodied response.").

## Validation

- Claude Desktop with the MCP server configured → `summon_agent slug:satoshi` shows the agent inline.
- `describe_agent` returns JSON-renderable identity block.
- `invoke_skill slug:satoshi skill:greet` → returns text + embed link that plays the greet animation.
- Unknown slug → 404 in tool result, not a server error.
- `npm run build` passes.

## Do not do this

- Do NOT overload one tool with every option. Separate tools per intent.
- Do NOT run arbitrary user skills server-side without sandboxing.
