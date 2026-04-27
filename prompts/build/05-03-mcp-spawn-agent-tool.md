---
mode: agent
description: 'Expose a render_agent MCP tool so Claude/hosts can spawn an agent body in a conversation'
---

# 05-03 · MCP `render_agent` tool

## Why it matters

Pillar 5's reach. Any MCP-compatible host (Claude, Claude Desktop, Lobehub) that speaks our MCP server can call `render_agent({id})` and receive a renderable card — letting the host spawn agents dynamically from a conversation, not just from pasted URLs.

## Prerequisites

- `api/mcp.js` already running.
- 04-04 (agent-card.json exists).

## Read these first

- [api/mcp.js](../../api/mcp.js) — current MCP tool catalog.
- [api/CLAUDE.md](../../api/CLAUDE.md) — MCP tool response shape (`content`, `structuredContent`, rate-limit buckets).

## Build this

1. **Add tool** `render_agent` to the MCP tool list in `api/mcp.js`:
    - Inputs: `{ id: string }`.
    - Scope: none (public). No auth required — the returned card is already public.
    - Returns:
        ```json
        {
        	"content": [
        		{ "type": "text", "text": "Render this three.ws: <name>" },
        		{
        			"type": "resource",
        			"resource": {
        				"uri": "https://.../agent/<id>/embed?kiosk=1",
        				"mimeType": "text/html"
        			}
        		}
        	],
        	"structuredContent": {
        		"card_url": "...",
        		"embed_url": "...",
        		"name": "...",
        		"description": "..."
        	}
        }
        ```
    - Rate-limit: reuse `limits.mcpIp` or add a `limits.mcpRender` preset if usage justifies.
2. **Usage event** — emit a `usage_events` row with `kind='mcp_render_agent', tool='render_agent'`.
3. **Update MCP catalog** in any `/.well-known` descriptor and the tool list endpoint if present.
4. **Smoke test** with the MCP inspector (`npx @modelcontextprotocol/inspector`) pointing at the dev server.

## Out of scope

- OAuth changes for the tool (public tool).
- A `list_agents` tool for a specific user (separate prompt; needs scoped auth).
- Live streaming of agent actions over MCP (separate prompt).

## Deliverables

- Diff to `api/mcp.js` adding the tool and its dispatch.
- A `usage_events` insertion.

## Acceptance

- MCP inspector lists `render_agent`.
- Calling it with a valid id returns a resource pointing at the embed URL.
- Rate-limit enforced.
- `npm run build` passes.
