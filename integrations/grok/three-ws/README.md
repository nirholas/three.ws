# three.ws plugin for Grok Build

A [Grok Build](https://github.com/xai-org/grok-build) plugin that gives Grok a 3D studio. From one sentence or one photo it makes a textured 3D model (GLB) or a rigged, animation-ready avatar, auto-rigs a GLB you already have, searches thousands of CC0 props, rigged characters and motion clips, renders a result so Grok can check it, explains a machine as an interactive 3D cutaway, and embeds any of it on a website.

## What needs an account

| Action | Account |
|---|---|
| Search the catalog, read the docs, render a model with `look_at_model`, write embed code | Free with no account for search, rendering and embed code |
| Make, refine or rig a model (`forge_free`, `forge_avatar`, `rig_mesh`, `refine_model`) | Needs a free three.ws account: OAuth sign-in on first connect, or an API key |

No tool in this plugin spends money or moves value, and nothing is billed. Models you make are saved to your three.ws account, unlisted until you share them.

## Install

From xAI's plugin marketplace, once it is listed there:

```bash
grok plugin marketplace add xai-org/plugin-marketplace   # once, if `grok plugin marketplace list` does not show it
grok plugin install three-ws --trust
```

Or open `/marketplace` in Grok Build, select `three-ws` and press `i`. The marketplace pins an exact commit, and Grok Build verifies that commit after the fetch.

From a local checkout of this folder:

```bash
git clone --depth 1 https://github.com/nirholas/three.ws three.ws-src
grok plugin install ./three.ws-src/integrations/grok/three-ws --trust
```

Without `--trust`, Grok Build shows the source, warns that the plugin brings an MCP server and skills, and stops without installing. Plugins in `~/.grok/plugins/` are trusted automatically, so copying this folder there also works. To load it for one headless agent process only, use `grok agent --no-leader --plugin-dir ./three.ws-src/integrations/grok/three-ws stdio`.

Check the install:

```bash
grok plugin list   # three-ws and its source
grok inspect       # Plugins: three-ws (user, enabled) 6 skills, 1 agents, 1 MCPs
                   # Skills: the 6 skills and the 5 commands, each "plugin: three-ws"
                   # Agents: three-ws:3d-art-director   MCP Servers: three-ws (http)
```

## Sign in

Making or rigging a model needs a free three.ws account. Pick one of two ways.

**OAuth (default).** Start Grok Build, type `/mcps`, select `three-ws` and press `i`. Your browser opens the three.ws sign-in, which can also create the account. Grok Build stores the token in `~/.grok/mcp_credentials.json` and refreshes it. Nothing is pasted into Grok Build.

**API key.** For headless runs, CI, or a machine with no browser: create a key at [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys), export it, and add a user-level server with the same name. It replaces the plugin's OAuth entry:

```bash
export THREE_WS_API_KEY=...   # keep it in your shell profile or secret manager, never in a repository
grok mcp add --transport http three-ws https://three.ws/api/mcp-studio --header 'Authorization: Bearer ${THREE_WS_API_KEY}'
```

The single quotes matter: Grok Build expands `${THREE_WS_API_KEY}` when it loads the config, so the key itself is never written to `config.toml`.

## Commands

| Command | What it does |
|---|---|
| `/make-3d <what to model>` | Checks the free catalog for a ready-made match, otherwise generates a textured GLB with `forge_free`, polls the job, renders the result to check it, and prints the GLB, viewer and poster links plus embed HTML |
| `/rig <https URL of a .glb>` | Renders the model to confirm it is a humanoid, auto-rigs it with `rig_mesh`, and prints the rigged GLB, a pose-studio link and embed HTML |
| `/embed <https URL of a .glb>` | Renders the model, decides whether it is a character or an object, and prints paste-ready HTML: an animated `<agent-3d>` for a character, a `<model-viewer>` for an object, both with pinned versions and integrity hashes. Embedding needs no account |
| `/three-ws-init` | Adds a `## 3D assets (three.ws)` section to the project's `AGENTS.md` (creating it if missing) from [`templates/AGENTS.md`](templates/AGENTS.md): how to find, make, load and embed GLBs, and how to keep API keys out of client code. Grok Build reads `AGENTS.md` at the start of every session |
| `/three-ws-tour` | A guided first run, from a catalog search to a rigged avatar |

## Agent

`three-ws:3d-art-director` makes one model to a brief and checks it like an art director. It generates (`forge_free` for an object, `forge_avatar` for a character), renders four views with `look_at_model`, judges subject, shape, material and geometry, refines once with `refine_model` naming the specific fault, keeps the better version, and delivers links and embed code. It stops after two iterations whatever the result, and it inherits only the `three-ws` MCP server (`mcpInheritance: named`). Ask for it by name: "use the 3d-art-director agent to make a brass desk lamp".

## Skills

| Skill | What it does |
|---|---|
| [`generate-3d-model`](skills/generate-3d-model/) | Text to a textured GLB |
| [`create-3d-avatar`](skills/create-3d-avatar/) | Text or a photo to a rigged avatar |
| [`rig-a-model`](skills/rig-a-model/) | Rig an existing GLB |
| [`find-3d-assets`](skills/find-3d-assets/) | Search the CC0 catalog before generating |
| [`anatomy`](skills/anatomy/) | Explain how a machine works as an interactive 3D cutaway |
| [`embed-three-ws-avatar`](skills/embed-three-ws-avatar/) | Put an avatar or model on a site with the `<agent-3d>` web component |

The plugin ships no hooks, no LSP servers, no install scripts and no executables. Every command already checks a GLB URL by rendering it with `look_at_model` before it rigs or embeds it, so a hook would repeat that check.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A command answers `sign_in_required` | The `three-ws` server is connected but not signed in | `/mcps`, select `three-ws`, press `i`, finish the browser sign-in, run the command again. Or use the API key route above |
| `grok mcp doctor three-ws` prints `handshake failed` with `Auth required` | Expected before the first sign-in: the OAuth entry asks the client to sign in | `/mcps`, select `three-ws`, press `i`. Or use the API key route above, after which the doctor reports `16 tools discovered` |
| `three-ws` shows as `blocked` in `/mcps` or `/plugins` | The plugin was installed without trust | `grok plugin install three-ws --trust` again, or install it under `~/.grok/plugins/` (trusted automatically) |
| The commands are missing from the `/` menu | The plugin is installed but disabled, or the session predates the install | `grok plugin enable three-ws`, then press `r` in the Plugins tab or start a new session |
| `/rig` or `/embed` says it cannot load the URL | The GLB is not public, is a local path, or its host refuses cross-origin reads | Use a public `https://` URL ending in `.glb`. Files three.ws returns always work; for your own host, enable CORS for `.glb` |
| A generation stays pending past 10 minutes | The GPU queue is long | The command prints the `job_id`; ask Grok to call `get_job` with it later. Nothing is lost |
| A rate-limit or quota answer | Per-account generation limits | The message says when the limit resets. Catalog search keeps working meanwhile |
| The API key route still asks for OAuth | The variable was empty when Grok Build started, or the header was double-quoted so the shell expanded it to nothing | `echo $THREE_WS_API_KEY` in the shell that starts `grok`, re-add the server with single quotes, then `grok mcp doctor three-ws` |

`grok mcp doctor three-ws` diagnoses the connection; `grok inspect` lists everything the plugin loaded.

## Network endpoints and credentials

| Endpoint | Why |
|---|---|
| `https://three.ws/api/mcp-studio?auth=oauth` | The MCP server: generation, rigging, catalog search, render checks, job polling. The query asks Grok Build to run the OAuth sign-in |
| `https://three.ws/oauth/authorize`, `https://three.ws/api/oauth/token`, `https://three.ws/api/oauth/register` | The OAuth 2.1 sign-in Grok Build runs in the browser (with dynamic client registration) |
| `https://three.ws/api/*` (plain HTTPS) | The skills show the same calls over HTTP for a shell or script |
| `https://three.ws/...` and its CDN | Links the tools return: GLB downloads, the viewer, pose studio and embed pages |
| `https://cdn.jsdelivr.net/npm/@google/model-viewer@4.4.0/` | The pinned `<model-viewer>` script `/embed` writes into your page (not called by the plugin itself) |

Credentials: a three.ws sign-in, done with OAuth 2.1 in the browser, or an API key you add yourself with `grok mcp add`. The plugin configures no headers, reads no environment variables, tokens or local files, and sends nothing about the user's machine. Generation is rate limited per account. The server never buys, sells, sends or spends. Full tool reference: [three.ws/docs/grok-bot](https://three.ws/docs/grok-bot).

## Maintenance

The skills are byte-identical copies of the canonical sources in [`.agents/skills/`](../../../.agents/skills/), and [`tests/grok-plugin.test.js`](../../../tests/grok-plugin.test.js) fails when a copy drifts or the layout changes. [`tests/grok-build-plugin-copy.test.js`](../../../tests/grok-build-plugin-copy.test.js) fails if any file here tells a signed-out user that generation will work, and [`tests/grok-build-plugin-tools.test.js`](../../../tests/grok-build-plugin-tools.test.js) opens a real MCP session to every server in `.mcp.json` and fails on any spend-capable tool or on a command that names a tool the server does not list.

The marketplace entry pins a commit of the standalone export of this folder. Rebuild it with `node scripts/export-plugin-repo.mjs --src integrations/grok/three-ws --out <dir>`; a change ships to Grok Build users only when the pin is bumped.

## License

Apache-2.0, the same as the rest of [three.ws](https://github.com/nirholas/three.ws). See [LICENSE](LICENSE).
