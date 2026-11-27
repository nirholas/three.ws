---
title: Sentence to 3D with a remote MCP server
seo_title: "Sentence to 3D Model: Remote MCP Tool with the Grok API and TypeScript SDK"
description: Attach a remote MCP server to Grok with the TypeScript SDK. It searches a free 3D catalog or makes a model from one sentence, and you get a GLB link.
type: recipe
level: beginner
languages: [typescript]
capabilities: [mcp, streaming]
models: [grok-4.7]
env: [XAI_API_KEY, THREE_WS_API_KEY]
icon: toolbox
authors: [three.ws]
date: 2026-11-27
---

# Sentence to 3D with a remote MCP server

Grok finds a chair in the free [three.ws](https://three.ws) catalog and, if none fits, makes a low-poly wooden chair. It uses the official xAI TypeScript SDK ([`@xai-official/sdk`](https://www.npmjs.com/package/@xai-official/sdk)) with the three.ws studio server attached as a **remote MCP tool**. xAI connects to the server and runs the tool calls on its own side, so there is no tool loop to write. The script prints each call as it happens, then the final GLB URL and a link that opens it in the three.ws viewer.

This is the TypeScript counterpart of [`examples/grok-python-mcp`](https://github.com/nirholas/three.ws/tree/main/examples/grok-python-mcp) in the three.ws repo, which does the same with the Python SDK.

## What you'll learn

- Attach a remote MCP server to Grok with the SDK's `mcp()` tool, limit Grok to three of its tools with `allowed_tools`, and pass a credential with `authorization`
- Report each server-side tool call as it completes with the `server_tool_call` stream event
- Continue a long-running job across rounds: a generation on a cold GPU can outlast one request, so the server answers with a pending `job_id` and the script asks Grok to collect it with `check_job`
- Carry a conversation into the next request with `response.toInput()`, since responses are not stored by default
- Test the MCP server on its own, with no xAI key, before spending a token

## Run it

You need Node.js 22.13 or later and an xAI API key from [console.x.ai](https://console.x.ai). The catalog search needs nothing else. To make a model when the catalog has no match, also set `THREE_WS_API_KEY`: a free key from [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys). xAI forwards it to the MCP server as the `authorization` token.

```bash
cd examples/grok-sentence-to-3d/typescript
npm install

# three.ws leg only: list the server's tools and search the catalog (no xAI key)
npm run check

# the full run
XAI_API_KEY=... THREE_WS_API_KEY=... npm start

# any other request
XAI_API_KEY=... THREE_WS_API_KEY=... npm start -- "make a brass desk lamp"
```

You can also put the variables in a `.env` file next to `package.json`; `npm start` loads it if it exists (node prints `.env not found` when it does not, which is harmless). `npm test` runs the unit tests for the pure helpers and `npm run typecheck` runs `tsc`.

| Variable | Default | Purpose |
|---|---|---|
| `XAI_API_KEY` (or `GROK_API_KEY`) | none | Required for the Grok run. |
| `THREE_WS_API_KEY` | none | Required to make a model. Catalog search is public. |
| `XAI_MODEL` | `grok-4.7` | Any xAI model that supports remote MCP tools. |
| `THREE_WS_MCP_URL` | `https://three.ws/api/mcp-studio` | Point at a local server while developing. |

Exit codes: `0` success, `1` a call failed (the message says which side and why), `2` no xAI key.

Cost: three.ws is free here. Catalog search needs no account, and making a model runs on the free lane and needs only a free account. xAI charges for Grok's input and output tokens at your model's [rate](https://docs.x.ai/docs/models), including the tool results Grok reads. A run is one short prompt plus the tool results, a few thousand tokens per round.

## How it works

`src/index.ts` builds one request with the `mcp()` tool and streams it:

```ts
const client = new SpaceXSI({ apiKey, retryBeforeOutput: true, maxRetries: 3 });

const stream = await client.responses.create({
  model: "grok-4.7",
  input,
  tools: [
    mcp({
      server_url: "https://three.ws/api/mcp-studio",
      server_label: "three-ws",
      allowed_tools: ["search_catalog", "forge_free", "check_job"],
      authorization: process.env.THREE_WS_API_KEY,
    }),
  ],
  reasoning: { effort: "low" },
  max_turns: 10,
  stream: true,
});

const response = await stream
  .on("server_tool_call", (call) => {
    if (call.type === "mcp_call") console.log(`tool     ${call.server_label}___${call.name} ${call.arguments}`);
  })
  .done();
```

- Grok sees each allowed tool with the server's label in front, like `three-ws___search_catalog`, and a tool the server adds later stays out of reach until it is listed in `allowed_tools`.
- A generation on a cold GPU can outlast one call. The server never holds a call past 40 seconds: it answers with a pending `job_id`. When Grok's reply has no `.glb` URL yet, the script waits 20 seconds, appends `response.toInput()` and a short "call `check_job` again" message to the input, and sends it again, for up to 8 rounds.
- `src/lib.ts` holds everything that needs no xAI key: argument parsing, the GLB URL extraction, and the three.ws leg spoken directly as MCP JSON-RPC over HTTP. `npm run check` uses it to run `initialize`, `tools/list` and a real `search_catalog` call against the server, so you can tell a server problem from an xAI problem.
- The viewer link is built from the GLB URL: `https://three.ws/viewer?src=<url-encoded GLB URL>`.
- Keys are read from the environment only and are never printed. The SDK reads `XAI_API_KEY` by itself; the script passes the key explicitly so `GROK_API_KEY` works too.

## Sample output

`npm run check`, captured 2026-11-27 against production (no xAI key involved):

```text
server   three-ws-3d-studio-free (https://three.ws/api/mcp-studio)
tools    21 offered; this example allows search_catalog, forge_free, check_job
catalog  Arm Chair 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/ArmChair_01.glb
catalog  Bar Chair Round 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/bar_chair_round_01.glb
catalog  Barber Shop Chair 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/BarberShopChair_01.glb
ok       three.ws leg is live
```

`XAI_API_KEY=... npm start`, the full run, captured 2026-11-27 against production with no three.ws key, so Grok answered from the free catalog in about 6 seconds with one `search_catalog` call. The `tool` line is the call xAI's cloud made to the three.ws server:

```text
note     THREE_WS_API_KEY is not set: catalog search works, but making a model needs a free key from https://three.ws/dashboard/api-keys
tool     three-ws___search_catalog {"q":"chair","kind":"object","limit":"12"}

GLB: https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/painted_wooden_chair_01.glb

glb      https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/painted_wooden_chair_01.glb
viewer   https://three.ws/viewer?src=https%3A%2F%2Fpub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev%2Fobjects%2Fpolyhaven%2Fglb%2Fpainted_wooden_chair_01.glb
```

The same command with a key that is not valid, captured the same day, shows how xAI answers. The request really reaches `api.x.ai`:

```text
note     THREE_WS_API_KEY is not set: catalog search works, but making a model needs a free key from https://three.ws/dashboard/api-keys
error    xAI answered 400 invalid-argument: Incorrect API key provided. You can obtain an API key from https://console.x.ai.
```

A free generation, the path `forge_free` takes when the catalog has no match, was captured on 2026-11-20 through the three.ws [curl example](https://github.com/nirholas/three.ws/blob/main/examples/grok-curl/README.md): "a low-poly wooden chair" became `https://three.ws/cdn/forge/anon/efefc9dc-5ed9-445f-8e87-fdc608826f39.glb` in 180 seconds.
