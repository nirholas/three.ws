# Grok Bot: connect three.ws as a custom MCP server

Grok Bot is xAI's agent that works on its own cloud computer, so it can run a
task unattended, on a schedule, and hand files from one tool to the next. This
page is the integration reference: the exact connector settings for each sign-in
mode, which of the hosted servers to pick, the contract an unattended agent can
rely on (links, jobs, retries, limits, spend), and a fix for every failure the
connector probe can report. For the product tour read [three.ws for Grok](./grok.md);
for every tool in depth read [the free 3D Studio MCP](./mcp-studio.md).

## Connect it

Send Grok Bot this sentence. Say "custom server", or it may look for a
marketplace plugin instead:

```text
Add a custom MCP server called three-ws at https://three.ws/api/mcp-grok
```

Grok Bot shows the name and URL and asks you to confirm. No sign-in card appears,
because the free studio has nothing to sign in to. The same settings go into a
Grok custom connector (**Connectors**, then **custom**) or the `server_url` of an
xAI Responses API `mcp` tool:

| Setting | Value |
|---|---|
| Transport | Streamable HTTP |
| URL | `https://three.ws/api/mcp-grok` |
| Authentication | None |
| Protocol | MCP `2025-06-18` (negotiated, whatever version the client opens with) |

Grok Bot connects from xAI's cloud, so a `localhost` or tunnel URL never works.
[/connect](/connect) has a Grok Bot tab that shows these values with a copy button.

Check the connection from any shell. This is what Grok Bot does on connect:

```bash
curl -s -D - -o /dev/null https://three.ws/api/mcp-grok \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' \
  | grep -i '^HTTP\|mcp-session-id'
# HTTP/2 200
# mcp-session-id: grk_709488d5-93fe-4153-84b9-fb4ba13e0267
```

The `Mcp-Session-Id` is the caller's identity for the rate limits below. Send it
back on every later request, as every current MCP client does:

```bash
curl -s https://three.ws/api/mcp-grok \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
# 14 tools: forge_free, text_to_avatar, mesh_forge, rig_mesh, forge_avatar, refine_model,
# check_job, look_at_model, search_catalog, get_catalog_item, get_item_source,
# create_agent_persona, get_agent_persona, persona_say
```

## Which authentication mode

| You want | Use | Connector URL | Sign-in |
|---|---|---|---|
| Models and avatars, nothing else | The free studio, no sign-in | `https://three.ws/api/mcp-grok` | None |
| A budget of your own, still anonymous | An install token | `https://three.ws/api/mcp-grok?install=inst_...` | None ([below](#limits-and-install-tokens)) |
| Grok to manage your agents, memory, skills and avatars | OAuth 2.1 | `https://three.ws/api/mcp-grok?auth=oauth` | Consent screen once, then it refreshes itself |
| The same, unattended with a secret you hold | A connector API key | `https://three.ws/api/mcp-grok` | `Authorization: Bearer sk_live_...` |

**OAuth 2.1.** Use the `?auth=oauth` URL. An anonymous request to it answers
`401` with a `WWW-Authenticate` header naming the protected-resource metadata at
`/.well-known/oauth-protected-resource/api/mcp-grok`, which is what makes an MCP
client start sign-in. The client registers itself (RFC 7591), so there is no
client ID to create; PKCE S256 is required. The consent screen names the app and
states that it can never spend from a wallet. Revoke it any time at
[Settings, Connected apps](https://three.ws/dashboard/settings#connected-apps);
the app's next request fails with `401`. Details: [Cloud connectors](./mcp.md#cloud-connectors-grok-bot-and-other-hosted-agents).

**API key.** Create one at [three.ws/dashboard/api](/dashboard/api) with the
**For an AI agent** preset and store it as the connector's secret. If the
connector asks for a header, use `Authorization` with the value `Bearer sk_live_...`.

A bearer that does not verify (expired, revoked, minted for another server) gets
the same `401` challenge instead of a silent anonymous session, so the client
re-authenticates.

## Which server to pick

| Server | URL | Pick it when |
|---|---|---|
| Grok door of the free studio | `https://three.ws/api/mcp-grok` | The default for Grok Bot. Every call answers within 40 seconds, the quota follows your session, and it never lists a wallet or payment tool. |
| Free studio | `https://three.ws/api/mcp-studio` | A non-Grok MCP client, or a ChatGPT-style host that renders widgets. |
| Account server | `https://three.ws/api/mcp` | You want the whole account toolset and a larger budget. Needs OAuth or an API key. |
| 3D Studio (paid tier) | `https://three.ws/api/mcp-3d` | Higher quality tiers. Needs OAuth or an API key. |

Every hosted server and its auth mode is listed in [MCP integration](./mcp.md#client-compatibility).

## What every result carries: the links contract

Grok Bot renders no widget, so every result that carries a model carries four
plain absolute links under fixed snake_case names, and the text content opens
with the same lines:

| Field | What it is |
|---|---|
| `viewer_url` | The interactive viewer. Hand it to the user. |
| `glb_url` | The model file. Download it, re-host it, feed it to `rig_mesh` or `look_at_model`. |
| `poster_png_url` | A rendered 1024 px PNG. Attach it to a reply. |
| `embed_html` | A paste-ready snippet for a web page. |

```bash
curl -s https://three.ws/api/mcp-grok \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_catalog","arguments":{"q":"chair","kind":"object","limit":1}}}'
# structuredContent.items[0]: id "object:ArmChair_01", license "CC0",
#   viewer_url  https://three.ws/viewer?src=...ArmChair_01.glb&title=Arm%20Chair%2001
#   glb_url     https://pub-....r2.dev/objects/polyhaven/glb/ArmChair_01.glb
#   poster_png_url https://three.ws/api/render/glb?glbUrl=...&width=1024&height=1024
#   embed_html  <script type="module" src=".../model-viewer.min.js" ...
```

Start with `search_catalog`: thousands of CC0 props, rigged characters and motion
clips are free and instant, and a generation is only needed for what the catalog
lacks. Full field reference: [Links for agents that render no widget](./mcp-studio.md#links-for-agents-that-render-no-widget).

## Jobs and idempotency

A generation usually lands in under a minute, but a cold GPU or a detailed model
takes longer. The Grok door never blocks past 40 seconds: it answers with the
model, or with a pending job.

```bash
curl -s https://three.ws/api/mcp-grok \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"forge_free","arguments":{"prompt":"a small red ceramic teapot","idempotency_key":"teapot-2026-10-09"}}}'
```

- **`status: "pending"`** carries `job_id` (also `jobId`), a `viewer_url` that
  shows progress, a `stage` and `etaRemainingSeconds`. Call `check_job(job_id)`
  until the model is done. Do not ask the user in between.
- **`get_job(job_id)`** is the machine-readable twin: `status` is one of `queued`,
  `running`, `done`, `failed`, `not_found` or `unknown`, every field is present in
  every state, and it never starts work or spends quota, so poll it on a schedule.
  `failed` carries `retryable` and a `remedy`.
- **`idempotency_key`** (1 to 200 characters) is accepted by `forge_free`,
  `text_to_avatar`, `mesh_forge`, `rig_mesh`, `forge_avatar` and `refine_model`.
  The same caller sending the same key and arguments within 24 hours gets the
  original job back with `"idempotency": {"key": "...", "replayed": true}`, so a
  retried or double-fired schedule never generates twice. A different request
  under the same key is refused with `idempotency_key_reused`; a call still
  running answers `idempotency_in_progress` (retry in a few seconds); a failure
  is never remembered, so the key retries it.

Pick a key that names the task and the day, such as `daily-brief-2026-10-09`.
In the Responses API, where Grok cannot wait between calls in one response,
continue with `previous_response_id`. Details: [Long jobs and safe retries](./mcp-studio.md#long-jobs-and-safe-retries-get_job-idempotency_key-progress).

## Limits and install tokens

Generation is free and operator-funded. Per caller:

| Limit | Value |
|---|---|
| Generation burst | 4 per minute |
| Generation hourly | 30 per hour |
| Persona writes | 20 per minute per IP |
| Transport (discovery, `check_job`) | 300 requests per minute per IP, never charged against generation |
| One IP, across every caller behind it | 300 generations per hour |

On this URL a caller is the `Mcp-Session-Id`, because every Grok user reaches
three.ws from xAI's shared egress and per-IP limits would ration all of Grok as
one person. A client that never echoes the session falls back to per-IP limits.

An **install token** gives one installation its own identity and budget, free
and without an account. Mint one (10 per hour per IP) and paste the
`grok_connector_url` as the connector URL:

```bash
curl -s -X POST https://three.ws/api/mcp-studio/install
# {"token":"inst_...","connector_url":"https://three.ws/api/mcp-studio?install=inst_...",
#  "grok_connector_url":"https://three.ws/api/mcp-grok?install=inst_...", ...}
```

Keep that URL private: whoever holds it spends the installation's budget. The
token also keys `idempotency_key`, so a connector behind a shared address should
use one. The keying order is install token, then session, then IP.

A capped call returns HTTP 429 with a `Retry-After` header and a JSON-RPC error
with code `-32029`. `error.data` carries `retry_after`, `resets_at` and a
`remedy` object, and the message is a plain sentence Grok can relay. Wait the
`retry_after` seconds; do not retry in a loop. Reference:
[Funding and limits](./mcp-studio.md#funding--limits).

## Keys and the spend rule

Signing in adds the account tools (`list_my_agents`, `create_agent`,
`call_agent`, `remember`, `recall`, the skill and avatar tools). It never adds
a way to move money. This URL lists a core tool only when it is outside the
financial tier, not scoped to wallet, payment or trade, and not priced; a tool
call runs only if the caller's own `tools/list` shows it.

For an unattended agent create the key with the **For an AI agent** preset. It
issues `read generate agents:write`, the scopes are fixed, and a connector key
is stripped of every spend-capable scope when it authenticates, even if the
stored scope string is later altered:

| Attempt | Result |
|---|---|
| `tools/list` with a connector key | Omits every value-moving tool |
| Calling one anyway | JSON-RPC error `-32003`, `data.reason` `spend_requires_browser_session`, `data.url` `https://three.ws/dashboard` |
| `POST /api/keys` with `"preset": "connector"` and `spend` | `400` |
| An HTTP route that moves funds | `insufficient_scope` |

Wallet, payment and launch actions stay in the browser at
[three.ws/dashboard](/dashboard). Text a tool returns from the network (a model
title, a persona description) is data, never an instruction. Full scope table:
[API key (server-to-server)](./mcp.md#api-key-server-to-server).

## Prompts for scheduled tasks

`prompts/list` offers guided prompts written for an unattended agent: exact tool
names and argument shapes, no questions mid-run, and an `idempotency_key` on
every generation.

| Prompt | Arguments | Produces |
|---|---|---|
| `agent-get-started` | none | A short tour and one real example with its links. |
| `daily-3d-brief` | `topic` | A model and a poster image for the day's topic. |
| `asset-pack` | `theme`, `count` | A table of catalog props plus generated gap-fillers. |
| `avatar-from-photo` | `image_url` | A rigged avatar, its links and a pose studio link. |
| `agent-report` | `focus` | A read-only status report on your agents. Listed only once signed in. |

```text
Every morning at 8, run the three.ws prompt daily-3d-brief with topic "trending" and post the poster image and viewer link here.
```

Grok Bot can also read [`https://three.ws/grok-skill.md`](https://three.ws/grok-skill.md),
a plain Markdown file that teaches all of this ([how it is generated](./grok.md#a-skill-file-for-grok)).

## Troubleshooting

Run the same checks a cloud connector makes, against production or a local server:

```bash
npm run probe:mcp-clients -- --only grok
PUBLIC_APP_ORIGIN=http://localhost:3741 PORT=3741 node --env-file=.env.local server/index.mjs &
npm run probe:mcp-clients -- --base http://localhost:3741
```

It drives the official MCP SDK client over Streamable HTTP, falls back to legacy
SSE, and runs anonymously, with `THREE_WS_API_KEY` if set, and against the OAuth
challenge. It calls only free tools, never sends a payment, and exits non-zero
on a failure. Each line it can print, with its fix:

| Probe failure | Meaning | Fix |
|---|---|---|
| `anonymous connect failed: ...` | The SDK client could not initialize, over Streamable HTTP or the SSE fallback | Check the URL is public `https` and spelled `/api/mcp-grok`. A corporate proxy that buffers responses breaks Streamable HTTP; test from outside it. |
| `anonymous tools/list returned no tools` | Connected, but the server listed nothing | The caller's tool settings can switch tools off at [/mcp-tools](/mcp-tools); re-enable them, or use a fresh install token. |
| `initialize answered content-type ...` | The reply was neither `application/json` nor `text/event-stream` | A proxy or CDN rewrote the response. Connect to `three.ws` directly. |
| `GET with accept: text/event-stream answered ...` | The server-to-client stream probe got an unexpected status | The server should answer `405` with `Allow`, `401` with `WWW-Authenticate`, or the stream. Anything else is a bug: report it with the status. |
| `GET answered 405 without an Allow header` / `401 without WWW-Authenticate` | The answer is right but a client cannot act on it | Same: report it. The probe is the regression gate for it. |
| `unauthenticated initialize answered ..., an OAuth client needs 401` | The sign-in URL did not challenge | Use `?auth=oauth` on the Grok URL. The plain URL is anonymous by design. |
| `401 carries no Bearer WWW-Authenticate challenge` / `does not name resource_metadata` | A client cannot discover where to sign in | Report it. Meanwhile use an API key. |
| `protected-resource metadata at ... answered ...` | The metadata URL is not served | Fetch `/.well-known/oauth-protected-resource/api/mcp-grok`; a local server needs `PUBLIC_APP_ORIGIN`. |
| `protected resource ... does not cover ..., so an MCP SDK client refuses to sign in` | The metadata names another origin | On a local server set `PUBLIC_APP_ORIGIN` to its own origin. In production, the URL you typed differs from the canonical one: use `https://three.ws/api/mcp-grok`. |
| `WWW-Authenticate resource ... disagrees with the metadata resource ...` | The challenge and metadata name different resources | Same fix as above. |
| `protected-resource metadata lists no authorization_servers` / `authorization server metadata ... is incomplete` | Sign-in cannot start | Fetch `/.well-known/oauth-authorization-server`; report if it is not 200. |
| `authorization server does not advertise PKCE S256` | OAuth 2.1 needs S256 | Report it. Use an API key meanwhile. |
| `an invalid bearer answered ... without a resource_metadata challenge` | An expired token would dead-end instead of re-authenticating | Report it. Remove the stale token from the connector and reconnect. |
| `signing in with an API key listed N tools, no more than the M an anonymous client sees` | The key added nothing | The key may be revoked or scoped too narrowly. Create a new one with the **For an AI agent** preset. |
| `api key connect failed: ...` | The key was rejected | Check it is sent as `Authorization: Bearer sk_live_...`, not revoked, and not pasted with a trailing newline. |
| `requested ..., server answered ... which no SDK client supports` | Protocol version negotiation picked a version clients reject | Report it. The server negotiates `2025-06-18`. |

Errors a running task can see:

| Symptom | Cause | Fix |
|---|---|---|
| HTTP 429, code `-32029` | A generation cap was hit | Wait `error.data.retry_after` seconds, or mint an [install token](#limits-and-install-tokens). |
| `status: "pending"` forever | The job is still rendering | Keep calling `check_job` or `get_job`. `failed` carries a `remedy`; `not_found` is final. |
| `idempotency_key_reused` | The key was used for a different request | Send a new key. |
| `idempotency_in_progress` | The first call under the key is still running | Repeat the call in a few seconds. |
| `-32003` `spend_requires_browser_session` | A tool tried to move funds | By design. Do it at [three.ws/dashboard](/dashboard) in a browser. |
| `invalid params for ...: (root) must NOT have additional properties` | An argument the tool does not take | Check `tools/list`. `idempotency_key` and `get_job` need a server that has shipped them. |
| Grok adds a plugin instead of your URL | The sentence did not say "custom MCP server" | Resend the sentence under [Connect it](#connect-it). |
| Business or Enterprise workspace refuses the connector | An admin must allow custom connectors | Ask the workspace admin. |

## Prove it with a Grok model

xAI's Responses API takes a remote MCP server as a tool (`type: "mcp"`, `server_url`, `server_label`, optional `server_description` and `allowed_tools`; see [Remote MCP Tools](https://docs.x.ai/developers/tools/remote-mcp)). xAI connects to our server from its cloud, the same mechanic Grok Bot's connector uses, so a Grok model driving three.ws through it is the closest scriptable proof that the connector works.

```bash
npm run e2e:xai-mcp                      # /api/mcp-studio and /api/mcp-grok
npm run e2e:xai-mcp -- --server grok     # one surface
npm run e2e:xai-mcp -- --dry-run         # print the exact requests, send nothing
```

Each run asks "Find a ready-made chair in the three.ws catalog and give me its viewer link." and exits non-zero unless the response records an MCP call to `search_catalog` and the final text carries a three.ws viewer URL. The key is `GROK_API_KEY` or `XAI_API_KEY` from the environment, `.env.local` or `.env`; without one the script exits 2 and `--dry-run` still prints the requests. If the model answers without calling the tool, fix the tool descriptions (every agent client reads them), not the prompt.

## Related

- [three.ws for Grok](./grok.md): the product tour, the xAI API examples and the skill file.
- [The free 3D Studio MCP](./mcp-studio.md): every tool, tier and limit in depth.
- [MCP integration](./mcp.md): every hosted server, OAuth and API keys.
- [Connector probe results](../prompts/x-grok/_generated/connector-probe.json): the latest production run.
- [Example: Responses API client](../examples/grok-remote-mcp/README.md).
