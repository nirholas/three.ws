# Kilo Code (Kilo-Org/kilo-marketplace) MCP submission

Target: `https://github.com/Kilo-Org/kilo-marketplace`, file `mcps/three-ws/MCP.yaml`.

Confirmed 2026-10-13 against the real `mcps/apify/MCP.yaml` (fetched live from `raw.githubusercontent.com`):
entries use `id`, `name`, `description`, `author`, `url`, `category`, and a `content` array of one or more
`{name, prerequisites, content, parameters?}` blocks, where `content` is a JSON string holding the actual
MCP server config Kilo Code writes into the user's `mcp_settings.json`.

## What ships

A remote, no-auth, streamable-HTTP MCP entry pointing at three.ws's free server. Matches the pattern
`https://three.ws/api/mcp-studio` already verified live in `packages/ai-sdk/test/tools.test.js` and
`packages/langchain/test/tools.test.js`.

## `mcps/three-ws/MCP.yaml`

```yaml
id: three-ws
name: three.ws
description: >-
  Generative 3D pipeline for agents: forge a textured GLB from a text prompt, auto-rig it,
  and render a turntable preview with geometry stats. Free, no API key required.
author: three.ws
url: https://three.ws
category: 3d-generation
content:
  - name: Default (no auth)
    prerequisites: []
    content: |
      {
        "three-ws": {
          "url": "https://three.ws/api/mcp-studio",
          "type": "streamable-http"
        }
      }
```

## Verification packet

- `MCP.yaml` field shape confirmed against the real `mcps/apify/MCP.yaml` example, fetched 2026-10-13.
- Tool schemas (`forge_free`, `rig_mesh`, `look_at_model`) confirmed live against production in this
  session's test runs for `packages/ai-sdk` and `packages/langchain`.

## Owner steps (not automatable here)

1. Fork `Kilo-Org/kilo-marketplace`, add `mcps/three-ws/MCP.yaml` with the content above.
2. Open a pull request titled "Add three.ws MCP server".
