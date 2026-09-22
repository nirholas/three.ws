# 17. One MCP endpoint, one OAuth, every tool

Read `docs/prompts/README.md` first.

## The problem

We run seven hosted MCP servers (`docs/mcp.md`): main, 3D, studio, agent wallet, bazaar, launch, and a partner lane. A developer has to know which one holds the tool they want, configure several, and authorize each. The best platforms expose their entire surface as one URL behind one OAuth grant, with tool groups the user can switch on and off, and the count of tools is a headline number.

## Build

- `https://three.ws/mcp` (and `/api/mcp/all` as the route): a single Streamable HTTP server that mounts every tool from every existing server, namespaced by the group field from prompt 03 (`agents_`, `wallet_`, `assets_`, `x402_`, and so on) with collision detection at boot (`npm run check:mcp-tools`, wired into `npm run gate`, fails on duplicate names or missing group and tier).
- One OAuth 2.1 grant with the union of scopes; each group maps to a scope so a consent screen shows what a client gets. API keys work the same way.
- The prompt 02 resources and prompts all live here too.
- Per-key and per-session tool selection from prompt 03 decides what `tools/list` returns; the default shows the read and write tiers of every group.
- The existing seven servers keep working as thin views of the same registry, so nothing already installed breaks. Their docs point to the unified endpoint as the default.
- Registry listings: update `server.json`, `/.well-known/mcp.json`, the MCP registry manifests, and the Claude plugin marketplace in `.claude-plugin/marketplace.json` to lead with the unified server. Publish the stdio twin as `@three-ws/mcp` under `packages/`, which proxies to the unified endpoint with a key.
- A live tool count and group list on `/mcp` (page in `data/pages.json`) and in `docs/mcp.md`, generated at build from the registry so the number never rots.

## Acceptance

- One `npx three-ws setup` entry gives Claude Desktop every three.ws tool.
- `npm run check:mcp-tools` fails when two servers define the same tool name.
- The tool count printed on `/mcp` equals `tools/list` with every group enabled.
- Docs updated, changelog entry tagged `feature, sdk`, `npm test` green.
