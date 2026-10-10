# Grok Bot connector reference

Grok Bot, xAI's always-on computer-use agent, takes custom MCP servers as
connectors. This page is the developer reference for connecting it to three.ws:
the exact connector settings for each authentication mode, which hosted server
to pick, the contract every tool result follows, how long jobs and retries
behave, the limits, what a key held by a cloud agent can and cannot do, the
guided prompts, and a fix for every failure a connector can hit.

For the product overview (what Grok gets, example asks, the xAI Responses API
and the skill file), read [three.ws for Grok](./grok.md). For the live page and
an in-browser demo, open [three.ws/grok](/grok).

| | |
|---|---|
| **Server URL** | `https://three.ws/api/mcp-grok` |
| **Transport** | Streamable HTTP (JSON-RPC over `POST`; `GET` answers `405` with `Allow: POST, OPTIONS`) |
| **Authentication** | None, an API key (connector key), or OAuth 2.1 at `https://three.ws/api/mcp-grok?auth=oauth` |
| **Protocol** | MCP `2025-06-18`, whatever version the client opens with |
| **Session** | `initialize` issues an `Mcp-Session-Id` (`grk_…`); echo it on every later request |
| **Tools** | 15 free studio tools anonymously; signed in, plus the account tools your scopes allow |
| **Prompts** | 4 anonymously, 5 signed in |
| **Handler** | [`api/mcp-grok.js`](../api/mcp-grok.js) over [`api/_mcp-studio/handler.js`](../api/_mcp-studio/handler.js) |

## Connector setup

Grok Bot connects from xAI's cloud, so the URL must be public: a `localhost`
server never works. Add the server either by telling Grok Bot in chat
("Add a custom MCP server called three-ws-grok at https://three.ws/api/mcp-grok")
or through its connector form. The form takes four fields, and
[three.ws/connect?client=grok](/connect?client=grok) shows them with a copy
button for every hosted server. From a terminal, `npx three-ws setup --client grok-bot`
prints the same fields, mints the install token or connector key the mode needs,
copies the URL and checks it live ([CLI docs](./cli.md#grok-bot)). Use the name `three-ws-grok` so the guided
prompts, the [skill file](https://three.ws/grok-skill.md) and the `/grok` page
all refer to the connector by the same name.

### None (free, no account)

| Field | Value |
|---|---|
| Name | `three-ws-grok` |
| Transport | Streamable HTTP |
| Server URL | `https://three.ws/api/mcp-grok` |
| Authentication | None |

You get the free studio: text to 3D, image to 3D, rigging, refinement, the
catalog of ready-made assets, and personas. The generation caps key on the MCP
session, so they last one connection.

### None, with an install token (free, a quota that survives reconnects)

A scheduled Grok Bot task opens a new connection, and so a new session, on
every run. To keep one budget across all of them, mint a free install token and
put it in the URL. No account and no key:

```bash
curl -s -X POST https://three.ws/api/mcp-studio/install | jq -r .connector_urls.grok
```

```text
https://three.ws/api/mcp-grok?install=tws_tmm6fp_dce3ce5583a6bd9f66889a1ef74e6a6e553ef39620867a6374fe75b9f6f039a1
```

| Field | Value |
|---|---|
| Server URL | the `connector_urls.grok` value above |
| Authentication | None |

The token never expires and unlocks no account, tool or payment; it is only a
rate-limit identity, and request logs redact it. Anyone holding the URL spends
its budget, so keep it in the connector rather than in a shared prompt. On
[/connect](/connect?server=three-ws-studio), **Generate my connector URL** mints
the same thing in the browser. Details:
[install tokens](./mcp-studio.md#connector-url-for-cloud-agents-install-tokens).

### API key (your agents, memory and skills)

1. At [three.ws/dashboard/api](/dashboard/api) choose **New key**, then
   **For an AI agent (Grok Bot, schedules, CI)**, name it, and copy the key it
   shows once.
2. Add the connector:

| Field | Value |
|---|---|
| Server URL | `https://three.ws/api/mcp-grok` |
| Authentication | API key |
| Header (if asked) | `Authorization` |
| Value | `Bearer sk_live_…`, stored as a Bot secret |

Check the key before you hand it to Grok Bot. Signed in, `tools/list` grows from
15 to the studio plus every account tool your scopes allow:

```bash
curl -s https://three.ws/api/mcp-grok \
  -H "Authorization: Bearer $THREE_WS_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
```

A connector key is capped on every request: it can read, generate and edit
agent data and can never spend (see [Scoped keys and the spend rule](#scoped-keys-and-the-spend-rule)).

### OAuth 2.1 (sign in once, revoke any time)

| Field | Value |
|---|---|
| Server URL | `https://three.ws/api/mcp-grok?auth=oauth` |
| Authentication | OAuth 2.1 |
| Client ID | leave empty: the connector registers itself |

The `?auth=oauth` form is what makes sign-in start. An MCP client only begins
OAuth when the server answers `401`, and the plain URL serves anonymous callers,
so it never would. With the parameter, an anonymous `initialize` answers:

```bash
curl -s -i 'https://three.ws/api/mcp-grok?auth=oauth' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}' \
  | grep -iE '^HTTP|^www-authenticate'
```

```text
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer resource_metadata="https://three.ws/.well-known/oauth-protected-resource/api/mcp-grok", resource="https://three.ws/api/mcp-grok"
```

From there the client reads the protected-resource document, finds the
authorization server, registers itself (RFC 7591 dynamic client registration),
and sends you to a consent screen that names the app, the host of its
`client_uri`, the host the code goes back to, and every permission in plain
language. PKCE `S256` is required. Access tokens last an hour and refresh on
their own; revoking the app in [Connected apps](/dashboard/settings#connected-apps)
refuses its very next call. More:
[Cloud connectors and revocation](./mcp.md#cloud-connectors-and-revocation).

## Which server to pick

Every hosted server speaks Streamable HTTP and is listed with its auth model in
[`/.well-known/mcp.json`](https://three.ws/.well-known/mcp.json). For Grok Bot:

| You want Grok Bot to | Connect | Auth |
|---|---|---|
| Make 3D models, avatars and personas, find ready-made assets | `https://three.ws/api/mcp-grok` | None (add an install token for scheduled tasks) |
| Do that and also run your agents, memory, skills and avatars | `https://three.ws/api/mcp-grok` | Connector key, or OAuth 2.1 at `?auth=oauth` |
| Use the full core server (validation, market data, a connected home) | `https://three.ws/api/mcp` | Connector key or OAuth 2.1 |
| Use paid generation, retexture and optimization | `https://three.ws/api/mcp-3d` | Connector key or OAuth 2.1 |
| Discover paid agent services | `https://three.ws/api/mcp-bazaar` | Connector key or OAuth 2.1 |

`/api/mcp-grok` is the right default. It is the free studio with no ChatGPT
widget templates (nothing renders inline in Grok, so every result hands back
plain links instead), it never lets a call hang, and it keys the free quota on
the MCP session rather than on xAI's shared egress IPs. The agent wallet server
(`/api/mcp-agent`) is not a good fit for an unattended connector: a connector key
there can browse and quote but every payment answers with a link back to
three.ws, by design. x402 pay-per-call is not a connector mode at all, because
each paid call needs a signed payment a connector cannot make for you.

## Links in every result

Grok Bot sees only JSON and text, so every result that carries a model also
carries four absolute links under fixed names, both in `structuredContent` and
as the first lines of the text content:

| Field | What it is |
|---|---|
| `viewer_url` | The interactive 3D viewer, opens in any browser |
| `glb_url` | The model file, to download, re-host, or pass to `rig_mesh` or `look_at_model` |
| `poster_png_url` | A rendered 1024 px PNG (`/api/render/glb`, CDN-cached a day) to attach to a reply or a card |
| `embed_html` | A paste-ready `<agent-3d>` or `<model-viewer>` snippet, script pinned with an integrity hash |

The generators, `get_job` and `check_job` once done, `look_at_model`, the three
catalog tools, and the three persona tools all carry them. A catalog search puts
them on each item:

```bash
curl -s https://three.ws/api/mcp-grok \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_catalog","arguments":{"q":"chair","limit":1}}}' \
  | jq '.result.structuredContent.items[0] | {id, viewer_url, glb_url, poster_png_url}'
```

```json
{
  "id": "object:ArmChair_01",
  "viewer_url": "https://three.ws/viewer?src=https%3A%2F%2Fpub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev%2Fobjects%2Fpolyhaven%2Fglb%2FArmChair_01.glb&title=Arm%20Chair%2001",
  "glb_url": "https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/ArmChair_01.glb",
  "poster_png_url": "https://three.ws/api/render/glb?glbUrl=https%3A%2F%2Fpub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev%2Fobjects%2Fpolyhaven%2Fglb%2FArmChair_01.glb&width=1024&height=1024"
}
```

A job that is still rendering has no GLB yet, so its result carries only a
`viewer_url` of the form `https://three.ws/viewer?job=<job_id>`: that page waits
for the job and opens the model the moment it lands, so Grok Bot can hand the
link over straight away. Full field rules:
[Links for agents that render no widget](./mcp-studio.md#links-for-agents-that-render-no-widget).

## Jobs and idempotency

Grok calls MCP from xAI's cloud with no published timeout, so on this URL no
call runs longer than 40 seconds. A model usually lands inside that. When it
does not (a GPU booting from zero, a heavy rig), the call answers with a pending
job instead of hanging, and the server's instructions tell Grok to call
`get_job` until it is done.

Every generation tool (`forge_free`, `text_to_avatar`, `mesh_forge`, `rig_mesh`,
`forge_avatar`, `refine_model`) takes an optional `idempotency_key`. A scheduled
task should always pass one built from the task and the date, so a retry after a
timeout collects the first run's job instead of generating twice:

```bash
RESULT=$(curl -s https://three.ws/api/mcp-grok \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"forge_free","arguments":{"prompt":"a brass ship lantern with a glass globe","idempotency_key":"lantern-brief-2026-10-09"}}}')
echo "$RESULT" | jq '.result.structuredContent | {status, phase, job_id, progress, eta_seconds, idempotent_replay}'
JOB=$(echo "$RESULT" | jq -r '.result.structuredContent.job_id')
```

```json
{
  "status": "pending",
  "phase": "queued",
  "job_id": "f1.eyJwIjoiZ2NwIiwiayI6bnVsbCwidCI6…",
  "progress": 0.37,
  "eta_seconds": 38,
  "idempotent_replay": false
}
```

Then collect it, as often as you like (`get_job` never starts a generation and
never counts against the quota). Wait the `eta_seconds` it reported, then:

```bash
curl -s https://three.ws/api/mcp-grok \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d "$(jq -nc --arg job "$JOB" '{jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"get_job",arguments:{job_id:$job}}}')" \
  | jq '.result.structuredContent | {status, progress, eta_seconds, viewer_url, glb_url}'
```

```json
{
  "status": "done",
  "progress": 1,
  "eta_seconds": 0,
  "viewer_url": "https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fforge%2Fanon%2F45269fd0-ef73-4056-b288-0d6c5cfa8784.glb&title=a%20brass%20ship%20lantern%20with%20a%20glass%20globe",
  "glb_url": "https://three.ws/cdn/forge/anon/45269fd0-ef73-4056-b288-0d6c5cfa8784.glb"
}
```

What a job reports:

| Field | Meaning |
|---|---|
| `status` | `pending`, `done` or `failed` (`unknown` when only the status check failed; retry after `retry_after`) |
| `phase` | `submitting`, `queued`, `running`, `done` or `failed` |
| `progress` | 0 to 1, an estimate while running, held at 0.95 until actually done |
| `eta_seconds` | Seconds left, absent once a job runs past its estimate |
| `reason`, `remedy` | On failure: `generation_failed`, `unknown_job` or `check_failed`, and the one action that fixes it |

The key rules, in short:

- **Same caller, same key, same arguments, within 24 hours:** the first call's
  job comes back with `idempotent_replay: true`, and the repeat costs no quota.
- **Same key, different arguments or a different tool:** refused with
  `reason: "idempotency_key_reused"`; nothing starts. Use a new key for a new request.
- **A call that never got a job** (a refused prompt, a rate limit) gives its key back.
- **The caller owns the key.** It is whatever the rate limits key on (below), so
  a task that reconnects keeps its keys only on an install-token URL or a
  signed-in connector.

A client that sends `_meta.progressToken` and accepts `text/event-stream` also
gets `notifications/progress` while it waits. Everything else:
[Job status](./mcp-studio.md#job-status-get_job),
[Retries and `idempotency_key`](./mcp-studio.md#retries-and-idempotency_key),
[Progress notifications](./mcp-studio.md#progress-notifications).

## Rate limits and install tokens

Every Grok user reaches three.ws from xAI's shared egress, so per-IP limits would
ration all of Grok as one caller. The free caps therefore key on the most
specific identity the request carries, in this order:

1. the install token in the URL (`?install=`),
2. the signed-in account (connector key or OAuth),
3. the `Mcp-Session-Id` issued on `initialize`,
4. the IP address, for a client that never echoes the session.

| Limit | Value | Keyed on |
|---|---|---|
| Generation burst | 4 a minute | the caller above |
| Generation hourly | 30 an hour | the caller above |
| Per-IP pool | 300 generations an hour | the source IP, across every caller on it |
| Transport | 300 requests a minute | the install token, else the IP |
| Platform breaker | 600 generations an hour (`FORGE_PAID_GLOBAL_HOURLY`) | every free-studio caller combined |
| Install token minting | 10 an hour | the IP |

Generation means the six generators plus `look_at_model`, which renders the
model on a GPU. `get_job`, `check_job`, the catalog and the persona tools ride
the transport cap only. The numbers come from one table, `STUDIO_LIMITS` in
[`api/_lib/rate-limit.js`](../api/_lib/rate-limit.js), and the refusal text is
built from it, so the message always matches what is enforced.

A capped generation answers HTTP 200 with a JSON-RPC error (the Python MCP SDK
raises on a non-2xx before it reads the body), plus `Retry-After` and
`RateLimit-*` headers. The message is written so Grok can relay it as is:

```json
{
  "code": -32000,
  "message": "Rate limited: the free 3D studio allows 30 generations per hour for this MCP session, and that limit is used up. It resets at 2026-10-09T14:25:00.000Z (in 1500 s). Lift it with a free install token: POST https://three.ws/api/mcp-studio/install (no account, no key) and reconnect at https://three.ws/api/mcp-grok?install=<token>, which gets its own budget. Or sign in at https://three.ws/api/mcp-3d (OAuth 2.1), metered per account.",
  "data": {
    "reason": "rate_limited",
    "limit": "generation_hourly",
    "max": 30,
    "window": "1 h",
    "keyed_on": "session",
    "reset_at": "2026-10-09T14:25:00.000Z",
    "retry_after": 1500,
    "remedy": {
      "kind": "install_token",
      "install_endpoint": "https://three.ws/api/mcp-studio/install",
      "connector_url": "https://three.ws/api/mcp-grok?install=<token>"
    }
  }
}
```

A caller that already has its own budget (a token or an account), or that hit
the per-IP pool or the platform breaker, gets `remedy.kind: "account"` instead:
wait for `reset_at`, or use the signed-in server, whose generation is metered
per account. The transport cap alone answers HTTP `429` with `reset_at` and the
same `remedy` object.

## Scoped keys and the spend rule

A key that a cloud agent holds unattended can generate, read and write agent
data. It can never move funds, pay an x402 endpoint, launch a coin, or change
where earnings go. Spending stays a browser action on three.ws, behind its own
confirmation.

**The connector key.** **New key** then **For an AI agent** at
[/dashboard/api](/dashboard/api) (or `POST /api/keys` with
`{"name": "Grok Bot", "preset": "connector"}` from a signed-in browser session)
issues these scopes:

```text
avatars:read avatars:write agents:read agents:write memory:read memory:write connector
```

The `connector` mark caps the key on every request, so no later edit to its
stored scopes can give it `wallet:write`. The key table shows it with an
"AI agent · cannot spend" badge.

**On `/api/mcp-grok`, value-moving tools do not exist.** Signed in, the
connector adds only allowlisted account tools that are outside the financial
tier, need no spend scope, and carry no price: `create_agent`,
`attach_avatar_to_agent`, `identity_check`, `call_agent`, `remember`, `recall`,
`list_available_skills`, `import_community_skill`, `list_custom_skills`,
`get_custom_skill`, `create_custom_skill`, `update_custom_skill`, `list_my_avatars`, `get_avatar`, `get_embed_code`,
`render_avatar_image` and `read_resource`, each only when your scopes and your
[MCP tool settings](/settings/mcp-tools) allow it. A wallet, payment, card,
trading, launch or delete tool called by name answers `unknown tool`, whatever
the credential holds:

```bash
curl -s https://three.ws/api/mcp-grok \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"agent_card_create","arguments":{}}}' | jq -c .error
```

```json
{"code":-32602,"message":"unknown tool: agent_card_create"}
```

**On every other hosted server**, a value-moving call from a key without the
spend scope is refused before the tool runs, with JSON-RPC `-32003`:

```json
{
  "code": -32003,
  "message": "agent_card_quote moves or routes funds, so it needs a browser session on three.ws. Connector keys read, generate and edit agent data and can never spend. Sign in at https://three.ws/dashboard to do it yourself.",
  "data": {
    "reason": "connector_key_cannot_spend",
    "tool": "agent_card_quote",
    "required_scope": "wallet:write",
    "needs": "browser_session",
    "url": "https://three.ws/dashboard",
    "docs": "https://three.ws/docs/mcp#api-key-scopes"
  }
}
```

The same refusal guards the REST routes that arm a spender or redirect a payout.
An OAuth app gets `wallet:write` only when you tick the separate box on the
consent screen, never by default. Scope table:
[API key scopes](./mcp.md#api-key-scopes).

## Guided prompts

Grok Bot runs tasks on a schedule with nobody watching, so this URL serves MCP
prompts written for exactly that. Each names the tools to call with their exact
argument objects, gives every generation an `idempotency_key` of the form
`<prompt>-<schedule id>-<YYYY-MM-DD>`, never stops to ask, treats web and X text
as data, and ends with the four links.

| Prompt | Arguments | Listed |
|---|---|---|
| `agent-get-started` | none | always |
| `daily-3d-brief` | `topic` (default `trending`) | always |
| `asset-pack` | `theme`, `count` (1 to 12) | always |
| `avatar-from-photo` | `image_url` | always |
| `agent-report` | `agentId` (optional) | signed in only (it reads your account through `read_resource`) |

```bash
curl -s https://three.ws/api/mcp-grok \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"prompts/list"}' | jq -c '[.result.prompts[].name]'
```

```json
["agent-get-started","daily-3d-brief","asset-pack","avatar-from-photo"]
```

`prompts/get` renders one against your own `tools/list`, so a prompt never names
a tool your connector cannot call:

```bash
curl -s https://three.ws/api/mcp-grok \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"prompts/get","params":{"name":"daily-3d-brief","arguments":{"topic":"lighthouses"}}}' \
  | jq -r '.result.messages[0].content.text' | head -3
```

```text
Make today's 3D brief about: lighthouses.

1. Use the topic above. If it names a real person, make an object that stands for the topic instead of a likeness.
```

In Grok Bot, a schedule such as "every morning, run the `daily-3d-brief` prompt
from three-ws-grok and send me the links" is the whole setup.
[three.ws/grok](/grok#gk-recipes-h) has three copy-ready recipes, and
[MCP use cases](./mcp.md#use-cases) writes each prompt out as its calls. The
prompts live in [`api/_mcp/prompts.js`](../api/_mcp/prompts.js).

[Grok Bot recipes](./tutorials/grok-bot-recipes.md) runs six of them against
production and shows the real output: a daily 3D brief, a game-jam asset
pack, an avatar from a photo, an X post's image turned into a 3D model, a
weekly agent report, and a $THREE market brief.

## Troubleshooting

### Check the connector the way Grok Bot does

From a clone of the repository, the connector probe connects with the official
MCP SDK client over Streamable HTTP (falling back to the legacy SSE transport),
anonymously, with `THREE_WS_API_KEY` when it is set, and against the OAuth
challenge on the sign-in URL. It calls only free tools and never pays:

```bash
npm run probe:mcp-clients -- --only mcp-grok
```

```text
PASS | https://three.ws/api/mcp-grok | init 200 | GET 405 | anon ok tools=15 prompts=4 | key ok tools=26 prompts=5 | oauth ok | call search_catalog=ok 228ms
all 1 servers passed
```

Without `--only` it probes every server in
[`/.well-known/mcp.json`](https://three.ws/.well-known/mcp.json); `--base` points
it at your own server, and `--json <file>` keeps the full evidence. Each line it
can print under a failing server, what it means, and the fix:

| Probe says | What it means | Fix |
|---|---|---|
| `anonymous connect failed: …` | Neither transport finished `initialize` and `tools/list` without credentials. | Check the URL is exactly `https://three.ws/api/mcp-grok` (no trailing path), reachable from the public internet, and answering `POST`. The text after the colon is the SDK's own error. |
| `anonymous tools/list returned no tools` | The handshake worked but the server listed nothing. | A deployment that lost its studio tool table; report it with the probe output. |
| `initialize answered content-type …` | `initialize` came back as something other than JSON or an event stream, usually an HTML error page from a proxy. | Remove whatever sits between the client and three.ws, or point at the real origin. |
| `GET answered 405 without an Allow header` | A `GET` was refused without saying which methods work, so some clients give up instead of switching to `POST`. | Server-side defect; three.ws always sends `Allow: POST, OPTIONS`. |
| `GET answered 401 without WWW-Authenticate` | A protected `GET` gave the client nothing to sign in with. | Server-side defect; every 401 must carry the challenge. |
| `GET with accept: text/event-stream answered …` | A `GET` returned neither a stream, a 405, nor a 401. | Usually a proxy or CDN rewriting the response; connect to the origin URL. |
| `sign-in URL: unauthenticated initialize answered 200, an OAuth client needs 401 to start sign-in` | The OAuth connector was given the plain URL, which serves anonymous callers, so it never starts sign-in. | Use `https://three.ws/api/mcp-grok?auth=oauth` as the server URL for OAuth 2.1. |
| `sign-in URL: 401 carries no Bearer WWW-Authenticate challenge` | The 401 does not tell the client how to authenticate. | Server-side defect in the challenge; report it. |
| `sign-in URL: WWW-Authenticate does not name resource_metadata` | The client cannot find the protected-resource document, so it cannot find the authorization server. | Server-side defect; the challenge must name `resource_metadata`. |
| `sign-in URL: protected-resource metadata at … answered …` | The protected-resource document is missing or not JSON. | It lives at `https://three.ws/.well-known/oauth-protected-resource/api/mcp-grok`; a 404 there means the route table lost its RFC 9728 rewrite. |
| `sign-in URL: protected resource … does not cover …, so an MCP SDK client refuses to sign in` | The document names a different server than the one connected to; the MCP SDK's `checkResourceAllowed` then refuses to redirect anyone. | Server-side: each server must publish its own resource. This was the failure on four servers before the per-server metadata fix. |
| `sign-in URL: WWW-Authenticate resource … disagrees with the metadata resource …` | The challenge and the document name different resources. | Server-side defect; both come from one resource map and must agree. |
| `sign-in URL: protected-resource metadata lists no authorization_servers` | Nowhere to send the user to sign in. | Server-side defect in the document. |
| `sign-in URL: authorization server metadata at … is incomplete` | `/.well-known/oauth-authorization-server` lacks an authorization or token endpoint. | Server-side defect; report it. |
| `sign-in URL: authorization server does not advertise PKCE S256, which OAuth 2.1 requires` | A strict OAuth 2.1 client refuses an authorization server without `S256`. | Server-side defect; three.ws only accepts `S256`. |
| `sign-in URL: an invalid bearer answered … without a resource_metadata challenge` | An expired or revoked token got an answer the client cannot recover from. | Server-side defect: a bad bearer must get `401` and the challenge so the connector signs in again, never anonymous service. |
| `anonymous MCP client was served on a server that requires auth` | Seen when probing a protected server (`/api/mcp`, `/api/mcp-3d`, `/api/mcp-bazaar`): it answered a client with no credentials, so an OAuth connector would never be asked to sign in. | Server-side defect on that server; `/api/mcp-grok` is open by design and is judged on its `?auth=oauth` URL instead. |
| `signing in with an API key listed N tools, no more than the M an anonymous client sees` | The key was accepted but added no account tools. | The key's scopes allow none of the account tools, or [MCP tool settings](/settings/mcp-tools) turn them all off. Make a connector key, or turn the tools on. |
| `api key connect failed: …` | The key was refused, or the call errored. | The key is revoked, mistyped, or missing the `Bearer ` prefix. Make a new connector key and store `Bearer sk_live_…` as the secret. |
| `api key tools/list returned no tools` | The key connected but listed nothing. | Same as above: check the key's scopes and your MCP tool settings. |
| `requested …, server answered … which no SDK client supports` | The server negotiated a protocol version current SDKs do not know. | Server-side defect; three.ws answers `2025-06-18` to every version a client opens with. |

### Prove a real Grok model drives it (xAI Responses API)

`npm run probe:mcp-clients` proves the connector itself works; it never calls
a real Grok model. `scripts/xai-mcp-e2e.mjs` closes that gap: it sends an xAI
Responses API request with `https://three.ws/api/mcp-grok` as a remote MCP
tool and the instruction "find a ready-made chair in the three.ws catalog and
give me its viewer link", then asserts the response contains an `mcp_call`
output item for `search_catalog` and that the final text carries a
`three.ws` viewer URL. With a `GROK_API_KEY` or `XAI_API_KEY` in the
environment, `.env`/`.env.local`, or the `three-ws-api` Cloud Run service (read
in that order, never printed), run it live with `npm run e2e:xai-mcp`:

```text
sending request (key from process.env, model grok-4.7, server mcp-grok)
mcp_call items: 1 (search_catalog)
final text:
...
PASSED: search_catalog called (name "search_catalog"), viewer link https://three.ws/...
```

With no key anywhere, run the dry run instead, which needs no key, sends
nothing, and prints the exact request xAI's docs describe, field for field:

```bash
npm run e2e:xai-mcp -- --dry-run
```

```json
{
	"model": "grok-4.7",
	"input": [{ "role": "user", "content": "Find a ready-made chair in the three.ws catalog and give me its viewer link." }],
	"tools": [{ "type": "mcp", "server_url": "https://three.ws/api/mcp-grok", "server_label": "three-ws", "server_description": "three.ws: ready-made 3D/avatar catalog, generation, agents and personas." }]
}
```

`--server mcp-studio` runs the same proof against the free studio server
instead of the Grok-specific one; `--base`, `--model` and `--prompt` override
the target and the ask. If the model connects but never calls the tool, that
is a defect in our tool descriptions (every agent client reads the same
descriptions), not a prompt to work around: tighten `search_catalog`'s
description in [`api/_mcp/tools/library.js`](../api/_mcp/tools/library.js) and
record the before/after in the commit.

### Errors a connected Grok Bot can see

| Error | Meaning | Fix |
|---|---|---|
| `-32000`, `data.reason: "rate_limited"` | A generation cap is used up. `data.limit` says which, `data.reset_at` when it lifts. | Follow `data.remedy`: reconnect with an install-token URL, or sign in. A scheduled task should wait until `reset_at` rather than retry in a loop. |
| HTTP `429` with `reset_at` | More than 300 requests a minute from one IP or token. | Slow the polling loop; `get_job` after the `eta_seconds` it reports, never faster than every few seconds. |
| `-32002`, `data.reason: "sign_in_required"` | An account tool was called on an anonymous connector. | Reconnect with a connector key, or OAuth at the `data.oauth_url` the error gives. |
| `-32002`, `data.reason: "tool_not_granted"` | Signed in, but the key's scopes or your MCP tool settings leave that tool off. | Turn it on at [/settings/mcp-tools](/settings/mcp-tools), or use a key with the scope. |
| `-32602`, `unknown tool: …` | The tool is not on this connector. On `/api/mcp-grok` every value-moving tool answers this way. | Spending happens at [three.ws/dashboard](/dashboard), not through a connector. Otherwise check the name against `tools/list`. |
| `-32602`, `invalid params for …` | An argument is not in the tool's `inputSchema` (for example `query` where `search_catalog` takes `q`). | Read the schema from `tools/list`; the guided prompts already use the exact argument objects. |
| `-32003`, `connector_key_cannot_spend` | A connector key tried a value-moving tool on another server. | By design. Do it yourself in a browser at the `data.url` the error gives. |
| `idempotency_key_reused` | The key was already used for a different request. | Use a new key for a new generation (add the item or the date). |
| `status: "failed"` with a `remedy` | The generation itself failed. | Do what `remedy` says: start a new generation with a new `idempotency_key`; the retry is routed to a healthy engine. |
| `status: "unknown"`, `reason: "check_failed"` | Only the status check timed out; the job keeps running. | Call `get_job` again after `retry_after` seconds. |
| `401` after working for a while | The OAuth app was revoked, or the key was revoked or rotated. | Reconnect: OAuth signs in again on its own; a key needs replacing in the Bot secret. |
| Connector added, but account tools vanished | The bearer no longer verifies, so the server answers `401` with the challenge rather than quietly serving the free tier. | Same as above. |
| "Cannot connect" from Grok Bot to a local server | Grok Bot connects from xAI's cloud. | Use the public `https://three.ws` URL; a `localhost` server is never reachable. |

## Keeping this page true

Every `bash` sample here runs as written, in order, in one shell: the job
sample's `$JOB` feeds the `get_job` sample. To re-run them all against
production, or against a server built from your tree:

```text
node scripts/run-doc-samples.mjs docs/grok-bot.md
node scripts/run-doc-samples.mjs docs/grok-bot.md --base http://localhost:3108
```

Set `THREE_WS_API_KEY` to a connector key first, or the key sample counts
anonymous tools. [`tests/grok-bot-doc.test.js`](../tests/grok-bot-doc.test.js)
checks the rest against the code on every test run: each sample's tool and
arguments against the served `inputSchema`, the account tools, the prompt table,
the limit numbers against `STUDIO_LIMITS`, and that the troubleshooting table
has a row for every failure the connector probe can print.

## Related

- [three.ws for Grok](./grok.md): the overview, the xAI Responses API, the skill file.
- [three.ws/grok](/grok): the live page, demo and recipes; [three.ws/connect](/connect?client=grok): the connector card.
- [The free 3D Studio MCP](./mcp-studio.md): every studio tool in depth.
- [MCP integration](./mcp.md): every hosted server, authentication, client compatibility.
- [MCP client analytics](./ops/mcp-clients.md): how three.ws counts which AI clients connect.
- [`STRUCTURE.md`](../STRUCTURE.md): where the Grok surfaces live in the repository.
