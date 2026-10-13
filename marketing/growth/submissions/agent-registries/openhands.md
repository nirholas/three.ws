# OpenHands (OpenHands/extensions) integration catalog submission

Target: `https://github.com/OpenHands/extensions`, file `integrations/catalog/three-ws.json`, validated
against `integrations/catalog.schema.json`.

Confirmed 2026-10-13 against two real catalog entries fetched live from `raw.githubusercontent.com`:
`integrations/catalog/apify.json` (stdio transport) and `integrations/catalog/cloudflare-docs.json` (remote
`shttp` transport with `auth: {strategy: "none"}`). The Cloudflare entry is the closer analog: three.ws's
free MCP server is also a remote, no-auth, streamable-HTTP endpoint.

## What ships

`three.ws` listed under a `3d` / `generative-ai` category, pointing at the live `/api/mcp-studio` server
verified in this session's `packages/ai-sdk` and `packages/langchain` test suites.

## `integrations/catalog/three-ws.json`

```json
{
  "id": "three-ws",
  "name": "three.ws",
  "description": "Forge a textured 3D model from text, auto-rig it, and render a turntable preview, all through one free MCP server.",
  "docsUrl": "https://three.ws/.well-known/skills/index.json",
  "iconBg": "#000000",
  "logoUrl": "https://three.ws/three-ws-mcp-icon.svg",
  "keywords": ["3d", "glb", "gltf", "mesh", "avatar", "rigging", "model generation"],
  "connectionOptions": [
    {
      "id": "none",
      "provider": "mcp",
      "transport": {
        "kind": "shttp",
        "url": "https://three.ws/api/mcp-studio"
      },
      "auth": {
        "strategy": "none"
      }
    }
  ]
}
```

## Verification packet

- Schema shape confirmed against `integrations/catalog.schema.json` plus two real live examples
  (`apify.json`, `cloudflare-docs.json`), fetched 2026-10-13.
- Tool schemas confirmed live against production in this session's test runs.

## Owner steps (not automatable here)

1. Fork `OpenHands/extensions`, add `integrations/catalog/three-ws.json` with the content above.
2. Validate locally against `integrations/catalog.schema.json` if the repo ships a validation script.
3. Open a pull request titled "Add three.ws to the integration catalog".
