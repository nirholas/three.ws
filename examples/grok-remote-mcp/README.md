# Grok makes a 3D model through three.ws

Grok generates a real, downloadable 3D model (GLB) by calling the free three.ws
MCP server through xAI's Responses API. xAI connects to the server and runs the
tool calls on its side; this script only talks to `api.x.ai`. Zero dependencies,
Node 20 or newer.

The server is `https://three.ws/api/mcp-grok`, the three.ws surface built for
Grok: every free studio tool. Making a model needs a free three.ws account, so a
real run sends its API key; nothing is ever charged. See the [Grok guide](../../docs/grok.md)
for Grok Bot and Grok connectors, and [three.ws/grok](https://three.ws/grok) for a live demo.

## Run it

```bash
cd examples/grok-remote-mcp

# 1. Prove the three.ws server answers and offers the tools (no key needed)
node index.mjs --check

# 2. See the exact request the script sends to xAI (no key, no call)
node index.mjs --dry-run

# 3. The real thing
XAI_API_KEY=xai-... THREE_WS_API_KEY=sk_live_... node index.mjs "a lunar lander with gold foil legs"
```

Get a key at [console.x.ai](https://console.x.ai). The run prints Grok's reply and
the viewer link, which opens an interactive 3D viewer in any browser.

| Variable | Default | Purpose |
|---|---|---|
| `XAI_API_KEY` | none | Your xAI API key. Required for a real run. |
| `THREE_WS_API_KEY` | none | A three.ws API key from [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys) (free account). Required for a real run: xAI sends it to the MCP server as the `authorization` token, and an anonymous call is answered `sign_in_required`. |
| `XAI_MODEL` | `grok-4.7` | Any xAI model that supports remote MCP tools. |
| `THREE_WS_MCP_URL` | `https://three.ws/api/mcp-grok` | Point at a local server (`http://localhost:8080/api/mcp-grok`) while developing. |

## How it works

The request carries one remote MCP tool:

```json
{
  "type": "mcp",
  "server_url": "https://three.ws/api/mcp-grok",
  "server_label": "three-ws",
  "authorization": "<THREE_WS_API_KEY>",
  "allowed_tools": ["search_catalog", "forge_free", "forge_avatar", "check_job"]
}
```

`allowed_tools` keeps Grok's context small and limits it to the tools this task
needs. Remove it to expose the whole catalog, including rigging, refinement and
the persona tools that give Grok a talking 3D body.

**Slow renders.** A model usually lands in under a minute, but a GPU that has
scaled to zero boots first. The server never holds a call past 40 seconds: it
answers with a pending job and tells Grok to collect it with `check_job`. Grok
cannot wait between calls inside one response, so the script continues the same
conversation with `previous_response_id`, every 30 seconds, until Grok replies
with a viewer link. Grok Bot needs none of this; it waits on its own.

**Quota.** Generation is free and rate-limited per MCP session. The server
issues an `Mcp-Session-Id` on `initialize`, and xAI echoes it, so your quota is
yours even though every Grok user reaches three.ws from xAI's cloud.
