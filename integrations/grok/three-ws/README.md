# three.ws plugin for Grok Build

A [Grok Build](https://github.com/xai-org/grok-build) plugin that gives Grok a free 3D studio. From one sentence or one photo it makes a textured 3D model (GLB) or a rigged, animation-ready avatar, auto-rigs a GLB you already have, searches thousands of CC0 props, rigged characters and motion clips, renders a result so Grok can check it, explains a machine as an interactive 3D cutaway, and embeds any of it on a website.

No account, no API key, no payment. No tool in this plugin spends money or moves value.

## Install

From the Marketplace tab (`/plugins`) once the plugin is listed there, or by copying this folder into Grok Build's plugin directory:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/nirholas/three.ws three.ws-src
git -C three.ws-src sparse-checkout set integrations/grok/three-ws
mkdir -p ~/.grok/plugins
cp -r three.ws-src/integrations/grok/three-ws ~/.grok/plugins/three-ws
```

Or point Grok Build at it for one session: `grok --plugin-dir ./three.ws-src/integrations/grok/three-ws`.

Then type `/mcps` to see `three-ws` connected, and run the `three-ws-tour` command (it autocompletes after `/`) for a guided walkthrough.

## What it ships

| Component | Path | What it does |
|---|---|---|
| MCP server | [`.mcp.json`](.mcp.json) | `three-ws`, the hosted Streamable HTTP server at `https://three.ws/api/mcp-grok` |
| Skill | [`skills/generate-3d-model/`](skills/generate-3d-model/) | Text to a textured GLB |
| Skill | [`skills/create-3d-avatar/`](skills/create-3d-avatar/) | Text or a photo to a rigged avatar |
| Skill | [`skills/rig-a-model/`](skills/rig-a-model/) | Rig an existing GLB |
| Skill | [`skills/find-3d-assets/`](skills/find-3d-assets/) | Search the CC0 catalog before generating |
| Skill | [`skills/anatomy/`](skills/anatomy/) | Explain how a machine works as an interactive 3D cutaway |
| Skill | [`skills/embed-three-ws-avatar/`](skills/embed-three-ws-avatar/) | Put an avatar or model on a site with the `<agent-3d>` web component |
| Command | [`commands/three-ws-tour.md`](commands/three-ws-tour.md) | `three-ws-tour`, a guided first run |

No hooks, no agents, no LSP servers, no install scripts and no local binaries.

## Network endpoints and credentials

| Endpoint | Why |
|---|---|
| `https://three.ws/api/mcp-grok` | The MCP server: generation, rigging, catalog search, render checks, job polling |
| `https://three.ws/api/*` (plain HTTPS) | The skills show the same calls over HTTP for a shell or script |
| `https://three.ws/...` and its CDN | Links the tools return: GLB downloads, the viewer, pose studio and embed pages |

Credentials: none. The plugin reads no environment variables, tokens or local files and sends nothing about the user's machine. Generation is rate limited per MCP session.

Optional sign-in: adding a second server at `https://three.ws/api/mcp-grok?auth=oauth` and signing in with a free three.ws account adds the account's agents and read-only Solana market intelligence. Sign-in is OAuth 2.1 in the browser; no key is pasted into Grok Build. That server also never buys, sells, sends or spends. Reference: [three.ws/docs/grok-bot](https://three.ws/docs/grok-bot).

## Maintenance

The skills are byte-identical copies of the canonical sources in [`.agents/skills/`](../../../.agents/skills/), and [`tests/grok-plugin.test.js`](../../../tests/grok-plugin.test.js) fails when a copy drifts or the server URL changes. After editing a source skill, copy it here again. The xAI marketplace pins a commit of this repository, so a change ships to Grok Build users only when the pin is bumped.

## License

Apache-2.0, the same as the rest of [three.ws](https://github.com/nirholas/three.ws). See [LICENSE](LICENSE).
