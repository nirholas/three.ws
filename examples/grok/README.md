# Build 3D with Grok and three.ws

Six runnable examples that pair xAI's Grok with the three.ws studio server: a
free catalog of CC0 3D assets, free text-to-3D generation, rigging and
rendering, all over MCP or plain HTTP. Each folder has its own README with what
it does, the prerequisites, the exact run command, output captured from a real
run, and what a run costs.

| Example | What it shows | Stack | Run it |
|---|---|---|---|
| [grok-python-mcp](../grok-python-mcp/) | Grok uses the studio server as a remote MCP tool: it searches the catalog for a chair and makes one if none fits. | Python, `xai-sdk` | `python main.py` |
| [grok-node-responses](../grok-node-responses/) | The same flow through xAI's Responses API with the `openai` package, then a rendered PNG of the model. | Node, `openai` | `npm start` |
| [grok-curl](../grok-curl/) | The whole flow in one shell script: Grok's remote MCP call, the job poll and the render. No SDK. | bash, `curl`, `jq` | `./run.sh` |
| [grok-x-search-to-3d](../grok-x-search-to-3d/) | Grok's X search sums up a topic from the last week and designs a prop for it. The studio makes the prop and the script drafts a post. It never posts. | Node, no dependencies | `node index.mjs "lunar landers"` |
| [grok-agent-avatar](../grok-agent-avatar/) | A 3D avatar with Grok as its brain: a small server keeps the xAI key, and the page shows the reply with a matching mood. | Node server + `<agent-3d>` | `npm start` |
| [grok-build-workflow](../grok-build-workflow/) | The three.ws plugin for Grok Build, xAI's coding agent, from install to `/make-3d`, plus a Vite + three.js starter that loads the GLB. | Grok Build, three.js | `npm run dev` |

A seventh, [grok-remote-mcp](../grok-remote-mcp/), is the zero-dependency Node
version that also collects a slow render across turns with
`previous_response_id`.

Three more reach Grok through other open-source tools:

| Example | What it shows | Stack | Run it |
|---|---|---|---|
| [grok-sentence-to-3d](../grok-sentence-to-3d/) | The remote MCP flow through xAI's official TypeScript SDK, printing each tool call as xAI runs it. Written in the xAI cookbook's layout. | TypeScript, `@xai-official/sdk` | `cd typescript && npm start` |
| [litellm-grok-gateway](../litellm-grok-gateway/) | Grok and the three.ws 3D tools behind one OpenAI-compatible LiteLLM proxy, with the studio server in LiteLLM's MCP gateway. | Python, LiteLLM | `litellm --config config.yaml`, then `python main.py` |
| [metagpt-3d-studio](../metagpt-3d-studio/) | A MetaGPT team (Art Director, Modeler, Reviewer) with Grok as every role's model. It finds or makes a model, looks at the render and stops after two iterations. | Python 3.11, MetaGPT | `python main.py` |

[docs/grok-toolkit.md](../../docs/grok-toolkit.md) maps these and the rest of
the open Grok toolkit (Grok Build, the plugin marketplace, the cookbook, Orca,
Happy, OpenHands and more) to the three.ws surface each one uses.

## Keys

Every example reads keys from the environment and never from a file in the
repository.

- `XAI_API_KEY` (or `GROK_API_KEY`): an xAI API key from
  [console.x.ai](https://console.x.ai). Needed for every Grok call.
- `THREE_WS_API_KEY`: a free three.ws account key from
  [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys). Needed only
  to make or rig a model. Catalog search and rendering need no account.

Every example also has a no-key mode (`--check`, `--catalog-only` or the
starter's catalog chair) that runs the three.ws side live, so you can see it work
before you add a key.

## Run all six at once

From the repository root:

```bash
npm run grok:examples-smoke
```

The smoke test copies each example into its own temp directory, installs it
there the way its README says (`npm ci`, a Python venv), and installs nothing
globally. For each example it runs the three.ws side live. With `XAI_API_KEY`
set, it runs the full Grok flow and expects success. Without it, it runs the
example with a deliberately invalid key and expects xAI's own "Incorrect API
key" answer, which proves the request reaches `api.x.ai` in the right shape. It
also makes one model on the free lane with `THREE_WS_API_KEY`.
`--only grok-curl,grok-agent-avatar` narrows the run and `--no-generate` skips
the generation.

The three examples in the second table install more (a LiteLLM proxy, MetaGPT on
Python 3.11), so a plain run leaves them out. Name them with `--only`, or pass
`--all` to run all nine:

```bash
npm run grok:examples-smoke -- --only grok-sentence-to-3d,litellm-grok-gateway,metagpt-3d-studio
```

Two more flags help when you are changing the MCP server itself.
`--mcp-url https://<public host>/api/mcp-studio` points the four examples where
xAI's cloud calls the server (`grok-python-mcp`, `grok-node-responses`,
`grok-curl`, `grok-sentence-to-3d`) at a development server. It has to be reachable from the internet,
for example through a tunnel, because xAI cannot call localhost, and those runs
send no three.ws key. `--save-output <dir>` writes one `<example>.txt` per
example with every command and what it printed, with the xAI key and the
three.ws key replaced by `<XAI_API_KEY>` and `<THREE_WS_API_KEY>`. The sample
output in each example's README comes from those files.

Captured 2026-11-27 with an xAI key, one line per example from that day's
runs. The first three examples ran against
production; the same day they also passed with `--mcp-url` set to a tunnel in
front of a server running this repository's `main`. The last three always use
production:

```text
PASS  grok-python-mcp        three.ws: MCP tools + catalog live | xAI: live run ok, https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/painted_wooden_chair_01.glb  (28.4s)
PASS  grok-node-responses    three.ws: catalog + PNG render live | xAI: live run ok, https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/painted_wooden_chair_01.glb  (17.7s)
PASS  grok-curl              three.ws: REST catalog + PNG render live | xAI: live run ok, https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/painted_wooden_chair_01.glb  (8.2s)
PASS  grok-x-search-to-3d    three.ws: MCP tools + catalog live, 6 unit tests | generation: https://three.ws/cdn/forge/anon/4e8135ca-2974-4028-82fe-6a3f7aad6a22.glb (fresh copy to GLB 85.4s) | xAI: live run ok, https://three.ws/cdn/forge/anon/3a089254-f1da-4027-90c9-a1505e1f10bc.glb  (186.3s)
PASS  grok-agent-avatar      three.ws: page + pinned <agent-3d> CDN script live, 8 tests | xAI: live reply (happy): Hello there, my lovely friend!  (6.4s)
PASS  grok-build-workflow    three.ws: starter built, 4 tests, catalog GLB live with CORS (768216 bytes) | Grok Build: grok CLI not installed here: the plugin is covered by tests/grok-plugin.test.js and tests/grok-build-plugin-*.test.js  (7.6s)
```

The Grok Build CLI was not on that run's `PATH`. A real Grok Build turn with the
plugin was captured the same day and is in the
[plugin README](../../integrations/grok/three-ws/README.md#sample-run).

Captured 2026-11-20 against production, without an xAI key:

```text
grok examples smoke: 6 example(s), xAI key not set (invalid-key proof), three.ws key minted for this run
PASS  grok-python-mcp        three.ws: MCP tools + catalog live | xAI: no key: api.x.ai answered the documented 400 "Incorrect API key"  (19.8s)
PASS  grok-node-responses    three.ws: catalog + PNG render live | xAI: no key: api.x.ai answered the documented 400 "Incorrect API key"  (41.0s)
PASS  grok-curl              three.ws: REST catalog + PNG render live | xAI: no key: api.x.ai answered the documented 400 "Incorrect API key"  (3.6s)
PASS  grok-x-search-to-3d    three.ws: MCP tools + catalog live, 6 unit tests | generation: https://three.ws/cdn/forge/anon/2f24bf99-b4a6-4cfb-b94a-11bafa0c180d.glb (fresh copy to GLB 82.4s) | xAI: no key: api.x.ai answered the documented 400 "Incorrect API key"  (83.8s)
PASS  grok-agent-avatar      three.ws: page + pinned <agent-3d> CDN script live, 8 tests | xAI: no key: the proxy relayed api.x.ai's documented 400 as a 502  (11.3s)
PASS  grok-build-workflow    three.ws: starter built, 4 tests, catalog GLB live with CORS (768216 bytes) | Grok Build: grok CLI not installed here: the plugin is covered by tests/grok-plugin.test.js and tests/grok-build-plugin-*.test.js  (42.5s)
three.ws key revoked
all 6 example(s) passed
```

The fastest path to a model is `grok-x-search-to-3d --prop`: 82 seconds from a
fresh copy of the folder to a finished GLB on 2026-11-20, install and tests
included (132 seconds in an earlier run that day, when the free lane was
busier), and 85 seconds on 2026-11-27.

## Cost

- **three.ws:** free. Catalog search, rendering and embed code need no account,
  and making or rigging a model runs on the free lane with a free account.
- **xAI:** each example's README says what one run uses: Grok's tokens at your
  model's [xAI rate](https://docs.x.ai/docs/models), plus xAI's per-source price
  for X search in `grok-x-search-to-3d`.

## Related

- [The Grok guide](../../docs/grok.md): every way to connect Grok to three.ws.
- [three.ws/grok](https://three.ws/grok): the live page, with the tool list read
  from the server.
