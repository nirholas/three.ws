# three.ws with Google ADK

A [Google Agent Development Kit](https://google.github.io/adk-docs/) agent that
calls the free three.ws MCP server through `MCPToolset`. The server is
`https://three.ws/api/mcp-studio`, the free studio surface: nothing to pay, and
listing its tools needs no key. Making or rigging a model needs a free three.ws
account, so set `THREE_WS_API_KEY` (from
[three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys)) and the
sample sends it as a Bearer token.

## Run it

```bash
cd examples/google-adk
npm install

# 1. Prove the MCP wiring end to end: list the tool catalog, then run a real
#    tool call (rig a known public GLB) against the live server. No model key.
#    Without THREE_WS_API_KEY it stops after discovery and says why.
THREE_WS_API_KEY=... npm run check

# 2. The full thing: an LlmAgent conversation that picks the tool itself.
#    Needs a Gemini credential (see below).
THREE_WS_API_KEY=... GOOGLE_API_KEY=... node index.mjs "rig this GLB: https://three.ws/avatars/cesium-man.glb"
```

| Variable | Default | Purpose |
|---|---|---|
| `THREE_WS_API_KEY` | none | A three.ws API key (free account). Needed to make, rig or render a model; sent as `Authorization: Bearer <key>`. |
| `GOOGLE_API_KEY` | none | A Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Required for a full conversation. |
| `GOOGLE_GENAI_USE_VERTEXAI` | unset | Set to `true` to use Vertex AI instead, with `GOOGLE_CLOUD_PROJECT`/`GOOGLE_CLOUD_LOCATION` and `gcloud auth application-default login`. |
| `THREE_WS_MCP_URL` | `https://three.ws/api/mcp-studio` | Point at a local server while developing. |

## How it works

```js
import { LlmAgent, MCPToolset } from '@google/adk';

const toolset = new MCPToolset({
  type: 'StreamableHTTPConnectionParams',
  url: 'https://three.ws/api/mcp-studio',
  // ADK sends `header` on every MCP request.
  header: { Authorization: `Bearer ${process.env.THREE_WS_API_KEY}` },
});

const agent = new LlmAgent({
  model: 'gemini-flash-latest',
  name: 'three_ws_agent',
  instruction: 'You help the user generate and rig 3D models with the three.ws studio tools.',
  tools: [toolset],
});
```

`MCPToolset.getTools()` discovers the full free studio catalog (`forge_free`,
`forge_avatar`, `rig_mesh`, `look_at_model`, `search_catalog`, and more) and
wraps each as an ADK `MCPTool`. The model picks the right tool from the
instruction and the user's prompt; ADK handles the `tools/call` round trip
over `MCPSessionManager`.

## Beyond the free lane

The full three.ws MCP server (`/api/mcp`) also exposes paid, x402-gated tools
(`text_to_animation` and others). Point `connection_params.url` at it and add
an `x402` client to `transportOptions.requestInit` to pay for those calls; the
free studio server above never needs a payment, only the free account key.

## See also

- [docs/google-adk.md](../../docs/google-adk.md): the three.ws-side integration doc.
- [docs/mcp.md](../../docs/mcp.md): the full MCP server reference.
- [examples/grok-remote-mcp](../grok-remote-mcp): the same free server, driven by Grok over xAI's Responses API instead of ADK.
