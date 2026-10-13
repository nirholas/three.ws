# Hermes Agent (NousResearch/hermes-agent) optional-MCP submission

Target: `https://github.com/NousResearch/hermes-agent`, file `optional-mcps/three-ws/manifest.yaml`.

Confirmed 2026-10-13 against the real `optional-mcps/context7/manifest.yaml` (fetched live from
`raw.githubusercontent.com`): remote HTTP MCP entries use `manifest_version: 1`, `transport: {type: http, url}`,
and `auth: {type: none}` for a no-key server, which matches three.ws's free `/api/mcp-studio` endpoint exactly.

## What ships

The manifest below describes three.ws's free MCP server (`forge_free`, `rig_mesh`, `look_at_model`) to any Hermes
agent that enables it. `text_to_animation` is intentionally left off this listing: it is paid and x402-gated, and
Hermes's optional-MCP format has no field for "pay per call," so listing it here would make the tool call fail
silently without a wallet. The free tools are the complete, working offering for this surface.

## `optional-mcps/three-ws/manifest.yaml`

```yaml
manifest_version: 1
name: three.ws
description: >
  Generative 3D for agents: forge a textured GLB from a text prompt, auto-rig it for
  animation, and render a turntable preview with geometry stats. Free, no API key.
source: https://three.ws
transport:
  type: http
  url: https://three.ws/api/mcp-studio
auth:
  type: none
suggest:
  keywords:
    - 3d
    - glb
    - gltf
    - mesh
    - avatar
    - rigging
    - model generation
  hosts:
    - three.ws
post_install: |
  three.ws exposes three free tools over this MCP server:
    - forge_free(prompt, tier?) -> generates a textured GLB from text
    - rig_mesh(glb_url) -> auto-rigs a static GLB with a humanoid skeleton
    - look_at_model(glb_url, views?, size?) -> renders a turntable preview + geometry stats
  No API key is required. A paid, x402-gated animation tool (text_to_animation) also exists
  at https://three.ws/api/mcp but is out of scope for this optional-MCP listing since it
  requires a per-call payment the agent must resolve with its own wallet.
```

## Verification packet

- `transport.type: http` + `auth.type: none` shape confirmed against the live `context7` entry
  (`optional-mcps/context7/manifest.yaml`) in the same repo, fetched 2026-10-13.
- `forge_free`, `rig_mesh`, `look_at_model` schemas confirmed live against `https://three.ws/api/mcp-studio`
  in this same session (see `packages/ai-sdk/test/tools.test.js` and `packages/langchain/test/tools.test.js`,
  which call all three against production and pass).

## Owner steps (not automatable here)

1. Fork `NousResearch/hermes-agent`, add `optional-mcps/three-ws/manifest.yaml` with the content above.
2. Open a pull request titled "Add three.ws optional MCP" with a one-paragraph description pointing at
   `https://three.ws/.well-known/skills/index.json` (see `packages/ai-sdk` and `packages/langchain` for
   framework-native tool wrappers of the same server).
