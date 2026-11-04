# n8n-nodes-three-ws

An n8n community node for three.ws. Two operations, no credentials:

| Operation | What it does |
| --- | --- |
| Generate 3D Model From Text | Submits a prompt to the free Forge lane, polls until the GLB is ready and outputs `glbUrl`, `viewerUrl`, `backend` and `previewImageUrl`. A repeated prompt is answered from Forge's cache at once. |
| Call MCP Tool | Calls any tool on the three.ws MCP studio server (`search_catalog`, `search_docs`, `forge_free`, `check_job`, ...) and outputs its text and structured content. |

The Options collection takes an API Base URL for a self-hosted three.ws.

## Install

In n8n: Settings, Community Nodes, Install, `n8n-nodes-three-ws`. Self-hosted only until the package is verified (see [SUBMITTING.md](./SUBMITTING.md)).

## Develop

```bash
npm install
npm test         # replays recorded production responses (test/fixtures)
npm run build    # n8n-node build
npm run lint     # n8n-node lint
```

Fixtures are real responses copied from `integrations/raycast/test/fixtures` plus a recorded `search_catalog` call on `/api/mcp-studio`.

License: MIT (n8n requires it for community packages).
