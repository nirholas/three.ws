# Grok 3D starter

Chat with Grok and a real, textured 3D model appears on the page. Ask for "a small brass desk
lamp" and Grok calls the [three.ws](https://three.ws) MCP server, a GLB renders on the GPU, and
it lands on a lit stage you can orbit. Say "make it chrome" and Grok refines the same model.

It is one small Node server and one page: no framework, no build step, one dependency
(`three`). Fork it and make it yours.

- **Grok** runs the conversation through the [xAI Responses API](https://docs.x.ai/developers/rest-api-reference/inference/responses)
  and decides which tool to call, using xAI's [remote MCP tools](https://docs.x.ai/developers/tools/remote-mcp).
- **three.ws** does the 3D work through its MCP server at `https://three.ws/api/mcp-grok`:
  catalog search, free text-to-3D generation, refinement, and render status.
- **Your server** holds both keys. The browser never sees them.

New here? [LEARN.md](./LEARN.md) is the ten-minute path from clone to a model on the stage.

## Quick start

You need Node 20.12 or newer and two keys:

| Key | Where to create it | Why |
| --- | --- | --- |
| `XAI_API_KEY` | [console.x.ai](https://console.x.ai) | Grok runs the chat. |
| `THREE_WS_API_KEY` | [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys) | Making a model needs a three.ws account. A free account is enough. |

```bash
git clone https://github.com/nirholas/grok-3d-starter.git
cd grok-3d-starter
npm ci
cp .env.example .env      # then paste both keys into .env
npm start
```

Open <http://localhost:8080>. If a key is missing or wrong, the page says which one, where to
create it, and the exact `.env` line to add, instead of showing the chat.

In GitHub Codespaces, add both keys as Codespaces secrets (the dev container asks for them) and
the server starts on port 8080 by itself.

## What happens when you send a message

```
browser ── POST /api/chat ──▶ server.mjs ── POST /v1/responses (stream) ──▶ xAI
   ▲                              │                                          │
   │   server-sent events:        │                                          ▼ Grok calls tools
   │   text, tool calls, results, │                              three.ws MCP (mcp-grok)
   └── render progress, model ◀───┘ ◀── get_job polling until the GLB is ready ┘
```

1. The page posts your message, the previous response id, and the model on the stage.
2. The server calls xAI with `stream: true` and one MCP tool. Its `authorization` is your three.ws
   key and its `allowed_tools` is limited to `search_catalog`, `forge_free`, `refine_model`,
   `check_job` and `get_job`, so Grok cannot reach anything else on the server.
3. Every stream event is passed on as it arrives: Grok's text, each tool call with its name and
   arguments, and each tool result.
4. Generation takes a few minutes, longer than one model turn. When a tool answers "still
   rendering", the server follows the job with `get_job` (sending live progress to the page),
   then starts a new round with `previous_response_id` so Grok hears that the model is ready.
5. The last response id goes back to the page, so "make it chrome" continues the same
   conversation and refines the same model.

Nothing on the page waits on a timer: every loading state, progress bar and tool row is drawn
from a real stream event.

## Files

| Path | What it does |
| --- | --- |
| `server.mjs` | HTTP server: static files, `/api/status`, `POST /api/chat` (server-sent events), CSP. |
| `lib/xai.mjs` | Builds the Responses API request and turns xAI stream events into page events. |
| `lib/chat.mjs` | One chat turn: rounds, job following, continuation with `previous_response_id`. |
| `lib/continuation.mjs` | Decides whether a turn is done or needs another round. |
| `lib/mcp.mjs` | Direct JSON-RPC calls to the three.ws MCP server (`get_job` polling, key check). |
| `lib/tool-results.mjs` | Reads three.ws tool results: pending job, model, catalog, sign-in, failure. |
| `lib/errors.mjs` | One clear message per failure (xAI 401/400/403/429/5xx, three.ws key, render). |
| `lib/validate.mjs` | Input validation, body size cap, per-address rate limit. |
| `lib/status.mjs` | Checks both keys once with their cheapest call, for the setup panel. |
| `public/` | The page: chat column, tool timeline, version strip, setup panel, 3D stage. |
| `shared/sse.js` | The server-sent events parser, used by the server and the page. |
| `test/` | `node:test` suites, with real captured fixtures. |
| `scripts/` | Live checks and the repository check. |

## Settings

Everything is read from the environment or `.env`. Only the two keys are required.

| Variable | Default | Meaning |
| --- | --- | --- |
| `XAI_API_KEY` | | xAI key. |
| `THREE_WS_API_KEY` | | three.ws key. |
| `XAI_MODEL` | `grok-4.7` | Any model at [docs.x.ai/developers/models](https://docs.x.ai/developers/models). |
| `XAI_REASONING_EFFORT` | `low` | `low`, `medium`, `high` or `xhigh`. |
| `PORT` | `8080` | Port to listen on. |
| `RATE_LIMIT_PER_MINUTE` | `8` | Chat messages per minute per address. |
| `MAX_RENDER_WAIT_SECONDS` | `900` | How long one turn follows a render before giving the viewer link. |
| `TRUST_PROXY` | off | Set to `1` behind a proxy that appends `X-Forwarded-For`. |

## When something goes wrong

Each failure has its own card with what happened and how to fix it:

- **Missing key:** the setup panel replaces the chat and names the key.
- **xAI did not accept the API key** (401 or 400): replace `XAI_API_KEY`.
- **xAI rate limit** (429): wait the number of seconds shown, then retry.
- **three.ws sign-in required:** the three.ws key is missing on the request; create one.
- **three.ws did not accept the key:** create a new key and replace `THREE_WS_API_KEY`.
- **Render failed:** the three.ws message, a retry button, and the viewer link when there is one.

## Tests and live checks

```bash
npm test                  # node:test suites, no network
npm run check             # structure, no secrets in the tree, every link reachable
npm run live:three-ws     # the three.ws half: the same MCP calls, a real GLB (THREE_WS_API_KEY)
npm run live:xai-401      # the xAI half without a key: xAI's 401 and the page's error card
npm run live:xai          # the full run: Grok makes a model, then refines it (both keys)
```

Fixtures under `test/fixtures/` say where they came from. A file marked `captured` is a real
answer recorded from the live service. The one xAI stream marked `documented` is assembled from
xAI's published event shapes (its header lists the doc pages), with real three.ws tool results
inside; `npm run live:xai -- --capture DIR` records a real one to replace it.

## Deploy

Anywhere Node runs:

```bash
npm ci --omit=dev
XAI_API_KEY=... THREE_WS_API_KEY=... npm start
```

On Google Cloud Run, straight from the source (the included `Dockerfile` is used):

```bash
gcloud run deploy grok-3d-starter --source . --region us-central1 --allow-unauthenticated \
  --set-env-vars XAI_API_KEY=xai-...,THREE_WS_API_KEY=sk_live_...
```

For anything public, keep the keys in Secret Manager and pass them with `--set-secrets` instead.
The rate limit is per instance and in memory; put a shared limit in front of it if you expect
heavy traffic.

## About

three.ws is a member of xAI's Grok for Startups program. This starter uses only public APIs:
the xAI Responses API and the three.ws MCP server.

## License

Apache-2.0
