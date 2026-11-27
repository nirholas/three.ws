# Grok + three.ws in Node (OpenAI-compatible client, Responses API)

Grok finds a chair in the free three.ws catalog and, if none fits, makes a
low-poly wooden chair. Then the script renders the GLB to a PNG through the
three.ws renderer. It uses the official [`openai`](https://www.npmjs.com/package/openai)
Node client pointed at `https://api.x.ai/v1` and the **Responses API**, with the
three.ws studio server attached as a remote MCP tool. xAI runs the tool calls on
its own side. The script prints each `mcp_call` output item and the final GLB
URL, then saves the render.

## Prerequisites

- Node 22 or newer.
- `XAI_API_KEY`: an xAI API key from [console.x.ai](https://console.x.ai).
- `THREE_WS_API_KEY`: a free three.ws account key from
  [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys). Making a
  model needs it. Catalog search and rendering are public.

## Run it

```bash
cd examples/grok-node-responses
npm ci

# three.ws leg only: catalog search plus a render to model.png (no xAI key)
npm run check

# print the exact request sent to xAI (no key, no call)
npm run dry-run

# the full run: tool calls, GLB URL, model.png
XAI_API_KEY=... THREE_WS_API_KEY=... npm start

# any other request and output path
XAI_API_KEY=... THREE_WS_API_KEY=... node index.mjs "make a brass desk lamp" --out lamp.png
```

| Variable | Default | Purpose |
|---|---|---|
| `XAI_API_KEY` (or `GROK_API_KEY`) | none | Required for the Grok run. |
| `THREE_WS_API_KEY` | none | Required to make a model. |
| `XAI_MODEL` | `grok-4.7` | Any xAI model that supports remote MCP tools. |
| `THREE_WS_MCP_URL` | `https://three.ws/api/mcp-studio` | Point at a local server while developing. |
| `THREE_WS_RENDER_URL` | `https://three.ws/api/render/glb` | The GLB to PNG renderer. |

Exit codes: `0` success, `1` a call failed, `2` no xAI key.

## How it works

```js
const client = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' });
let response = await client.responses.create({
  model: 'grok-4.7',
  input: [{ role: 'user', content: 'Use three-ws to find a chair ...' }],
  tools: [{
    type: 'mcp',
    server_url: 'https://three.ws/api/mcp-studio',
    server_label: 'three-ws',
    allowed_tools: ['search_catalog', 'forge_free', 'check_job'],
    authorization: process.env.THREE_WS_API_KEY,
  }],
});
// response.output holds { type: 'mcp_call', name, arguments } items; the answer is response.output_text.
```

If the reply has no GLB yet (a pending generation), the script waits 20 seconds
and continues the same conversation with `previous_response_id`, up to 8 rounds.
The render is a plain `GET https://three.ws/api/render/glb?glbUrl=...&width=1024&height=1024`
that answers `image/png`.

## Sample output

`node index.mjs --check --out check.png` (`npm run check` writes `model.png`
instead), captured 2026-11-27 against production:

```text
server   three-ws-3d-studio-free (https://three.ws/api/mcp-studio)
catalog  Arm Chair 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/ArmChair_01.glb
png      check.png (596134 bytes, rendered by https://three.ws/api/render/glb)
ok       three.ws leg is live
```

`XAI_API_KEY=... npm start`, the full run, captured 2026-11-27 against
production with no three.ws key, so Grok answered from the free catalog:

```text
note     THREE_WS_API_KEY is not set: catalog search works, but making a model needs a free key from https://three.ws/dashboard/api-keys
tool     search_catalog {"q":"chair","kind":"object"} (ok)

GLB: https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/painted_wooden_chair_01.glb
Viewer: https://three.ws/viewer?src=https%3A%2F%2Fpub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev%2Fobjects%2Fpolyhaven%2Fglb%2Fpainted_wooden_chair_01.glb&title=Painted%20Wooden%20Chair%2001

glb      https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/painted_wooden_chair_01.glb
png      model.png (144478 bytes, rendered by https://three.ws/api/render/glb)
```

The full run with an xAI key that is not valid, captured the same day. The
request really reaches `api.x.ai`, and the error is xAI's own:

```text
note     THREE_WS_API_KEY is not set: catalog search works, but making a model needs a free key from https://three.ws/dashboard/api-keys
error    HTTP 400: Incorrect API key provided. You can obtain an API key from https://console.x.ai.
```

## Cost

- **three.ws:** free. Catalog search and rendering need no account (60 renders
  per 10 minutes per IP). Making a model runs on the free lane with a free account.
- **xAI:** Grok's input and output tokens at your model's
  [xAI rate](https://docs.x.ai/docs/models), a few thousand tokens per round.
