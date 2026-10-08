# three.ws 3D Studio — free MCP endpoint

A free, non-crypto MCP server that turns a text prompt or an image into an
interactive, downloadable 3D model (GLB). It exposes **only** 3D-generation
tools — no account, no payment, no API key, no wallet, no token. Built for the
OpenAI ChatGPT App Directory and any MCP client.

> The paid, crypto-enabled studio (per-call USDC via x402) is a separate server
> at `/api/mcp-3d`. This endpoint shares none of that surface.

## Connect

| | |
|---|---|
| **URL** | `https://three.ws/api/mcp-studio` |
| **Transport** | Streamable HTTP (JSON-RPC over `POST`) |
| **Auth** | None — open and free |
| **Protocol** | MCP `2025-06-18` |
| **Manifest** | [`server-studio.json`](../server-studio.json) |

`GET` is intentionally not offered (no server-initiated stream); the server
answers every request synchronously over `POST`. `OPTIONS` is handled for CORS.

### ChatGPT (Apps SDK)

Three front doors serve the same tools over one handler
([`api/_mcp-studio/handler.js`](../api/_mcp-studio/handler.js)) and share one
generation quota:

| URL | Serves | Use it for |
|---|---|---|
| `https://three.ws/api/mcp-studio` | all fourteen tools (the 3D tools, the asset catalog, the persona tools), both widgets | any MCP host, including a ChatGPT developer-mode connector |
| `https://three.ws/api/mcp-chatgpt` | the eight 3D tools and the model viewer | the ChatGPT plugin directory listing |
| `https://three.ws/api/mcp-grok` | all fourteen tools, every call answered within 40 s, quota per MCP session | Grok Bot, Grok connectors and the xAI Responses API ([guide](./grok.md)) |

The ChatGPT surface leaves out the three catalog tools, which keeps that listing's reviewed tool set unchanged, and the three persona tools, because their widget
frames the hosted embodiment page, which needs `frameDomains`. OpenAI's app
guidelines reserve frame domains for embedding an essential third-party
experience and say those apps "are often not approved for broad distribution";
framing our own page is not that case. `SURFACES` in
[`api/_mcp-studio/dispatch.js`](../api/_mcp-studio/dispatch.js) is the single
definition of what each door advertises.

Add either connector with **No authentication**. Each generation tool renders its
result inline in an interactive 3D viewer widget
(`ui://widget/three-studio-model.html`); on `/api/mcp-studio` the persona tools
also render a living agent body in their own widget
(`ui://widget/three-studio-persona.html`). The model viewer's `openai/widgetCSP`
allowlists exactly two origins, `https://three.ws` and the model-viewer CDN,
because the widget re-serves every off-origin GLB through `/api/glb` and every
poster through `/api/img`. ChatGPT enforces that CSP, and its review flags
wildcard or unused domains.

### Any MCP client

```bash
curl -s https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Connector URL for cloud agents (install tokens)

Grok Bot, the xAI Responses API and other hosted agents call MCP from their
vendor's cloud, so every user of one agent reaches three.ws from the same few
IPs. Keyed per IP, they would all share one free quota. An **install token**
gives one installation its own quota, free and anonymous: no account, no key.

1. Mint a token (or click **Generate my connector URL** on
   [/connect](/connect?server=three-ws-studio) with the free studio selected):

   ```bash
   curl -s -X POST https://three.ws/api/mcp-studio/install
   ```

   ```json
   {
     "token": "tws_tmlst1_a2b4b...",
     "created_at": "2026-10-08T19:29:13.000Z",
     "connector_url": "https://three.ws/api/mcp-studio?install=tws_tmlst1_a2b4b...",
     "connector_urls": {
       "studio": "https://three.ws/api/mcp-studio?install=tws_tmlst1_a2b4b...",
       "grok": "https://three.ws/api/mcp-grok?install=tws_tmlst1_a2b4b...",
       "chatgpt": "https://three.ws/api/mcp-chatgpt?install=tws_tmlst1_a2b4b..."
     },
     "limits": { "generations_per_minute": 4, "generations_per_hour": 30, "requests_per_minute": 300 },
     "note": "Keep this URL private: anyone holding the token spends its budget. It never expires and unlocks no account or payment."
   }
   ```

2. Add the connector with that URL and **No authentication**. The same token
   works on every studio door; Grok Bot users want the `grok` URL.

How it behaves:

- The transport cap and the generation burst and hourly caps key on the token
  instead of the IP. Two tokens from one IP have independent budgets.
- A missing, malformed or forged token is ignored and the request keys exactly
  as it would without one (per IP, or per ChatGPT user / MCP session on those
  doors).
- Minting is limited to 10 tokens an hour per IP, and every token-keyed caller
  still shares the per-IP pool (300 generations an hour) and the platform-wide
  breaker, so tokens add per-caller fairness, never extra total GPU budget.
- A token is self-authenticating (an HMAC over its mint time and a random
  nonce, keyed by `MCP_INSTALL_SECRET`, else `JWT_SECRET`), so nothing is stored
  and verifying one costs no database round trip. It unlocks no tool, account
  or payment; it is only a rate-limit identity, and request logs redact it.

`node scripts/probe-mcp-install-tokens.mjs --base <origin>` mints two tokens,
caps the first and shows the second still admitted, end to end.

### ChatGPT custom GPT (Actions)

The same free lane also ships as a REST Actions surface for the **"three.ws 3D
Studio"** custom GPT: `POST /api/3d/studio` submits a prompt and
`GET /api/3d/studio?job=<id>` polls it, with an age-13+ safety gate and
store-clean responses (model URLs and job state only). The machine-readable
contract is the OpenAPI schema the platform serves at
[`https://three.ws/.well-known/3d-studio-openapi.yaml`](../public/.well-known/3d-studio-openapi.yaml),
which is what the custom GPT imports; the same endpoint is written up in prose in
the [API reference](./api-reference.md). Use the MCP connector above when you
want inline 3D widgets; the custom GPT covers plans without connector support.

How AR rides both ChatGPT surfaces (the `arUrl` contract, the device-aware
launcher, living avatars, link unfurls) is documented end to end in
[AR in ChatGPT](./chatgpt-ar.md).

## Tools

`tools/list` returns exactly **fourteen** tools, and they split five ways:

- **Six generation tools** (`forge_free`, `text_to_avatar`, `mesh_forge`,
  `rig_mesh`, `forge_avatar`, `refine_model`), in the table below.
- **One collector**, `check_job`, also in the table below.
- **One inspector**, `look_at_model`, also in the table below.
- **Three asset catalog reads** (`search_catalog`, `get_catalog_item`,
  `get_item_source`), in **Ready-made assets** below.
- **Three persona/embodiment tools** (`create_agent_persona`,
  `get_agent_persona`, `persona_say`), in the **Embodiment** section further down.

All fourteen are free and keyless.

The six generation tools run operator-funded on the platform's own generation
pipeline. Annotations: `readOnlyHint:false`, `destructiveHint:false`,
`idempotentHint:false`, `openWorldHint:true` (work runs against external model
APIs; nothing is ever modified or deleted). `check_job` reads like a status probe
but is not one, and its annotations say so (`readOnlyHint:false`,
`idempotentHint:false`): the FIRST check that finds a job finished materializes
the creation, copying the model into our storage, recording the row and running
the quality gate, and it can route failed work to another provider. Later checks
of the same job are served from the done-frame cache, which is exactly why it is
not idempotent either. It still never counts against the generation quota.
`look_at_model` is genuinely read-only and idempotent,
but it renders frames server-side, so it rides the same per-IP generation
quota as the six generators.

| Tool | Title | Input | Returns |
|---|---|---|---|
| `forge_free` | Generate a 3D model from text | `prompt`, `tier?` | GLB model |
| `text_to_avatar` | Generate a 3D avatar | `prompt?` / `image_url?` | GLB avatar |
| `mesh_forge` | Generate a 3D mesh (art-directed) | `prompt?` / `image_url?` | GLB mesh |
| `rig_mesh` | Rig a 3D model for animation | `glb_url` | rigged GLB |
| `forge_avatar` | Generate a rigged, animation-ready avatar | `prompt?` / `image_url?`, `allow_non_humanoid?` | rigged GLB avatar |
| `refine_model` | Refine a 3D model by describing a change | `glb_url`, `instruction`, `parent_prompt?`, `parent_lineage?`, `parent_index?` | refined GLB + version lineage |
| `check_job` | Check a pending 3D generation and collect it | `job_id` | GLB model, or an updated pending state |
| `look_at_model` | Look at a 3D model | `glb_url`, `views?` (up to 6 of `front`, `three-quarter`, `side`, `back`, `top`, `bottom`; default three-quarter, front, side, back), `size?` (128 to 1024 px, default 512) | rendered frames as images, plus geometry stats (triangles, materials, textures) and a plain reading of them |

### Ready-made assets (`search_catalog`, `get_catalog_item`, `get_item_source`)

Before generating anything, check whether three.ws already publishes it. These
three read-only tools search the same catalog as the main server's tools of the
same names ([`api/_mcp/tools/library.js`](../api/_mcp/tools/library.js), served
here by [`api/_mcp-studio/catalog-tools.js`](../api/_mcp-studio/catalog-tools.js)):
the CC0 prop library, the ready-made rigged characters and the motion-clip library.
`search_catalog` takes `q`, `kind`, `category`, `tag`, `limit` and `offset`;
`get_catalog_item` and `get_item_source` take the `id` it returns, and
`get_item_source` hands back paste-ready code (the `<agent-3d>` tag pinned to a
release and its integrity hash, `<model-viewer>`, three.js or React). Schemas and
example responses are in [docs/mcp.md](./mcp.md#search_catalog).

They are here because this is the server an MCP client can use with no account.
The main server at `https://three.ws/api/mcp` lists the same three tools, but a
protocol client that connects there is sent through three.ws sign-in first,
because most of that server's tools act on an account. The catalog tools never
count against the generation quota.

### Quality tiers

`forge_free` takes an optional `tier` of `draft`, `standard`, or `high`.
**`standard` is the default**, and it is what you get when you omit the
argument. It is the balanced free lane: reliably textured, and served by
whichever free engine the router picks for the prompt (typically the
self-hosted TRELLIS worker).

`high` is a real option, not a placeholder. Ask for it by name and the
generation runs on our own self-hosted Hunyuan3D GPU worker for denser geometry.
It stays opt-in rather than becoming the default for two reasons. That worker is
scale-to-zero, so a cold container pays a spin-up on top of the generation. And
the high lane is platform-funded behind an internal access gate: if the gate
refuses (402) or the submit times out, the call degrades to standard rather than
failing the conversation, so a default of `high` would sometimes mean serving
standard while the docs promised more.

Nothing here is ever billed to you. The high tier is platform-funded, so the
caller stays anonymous and keyless at every tier. A generation can outlive one
tool call at any tier; see [Pending generations](#pending-generations-check_job)
for how it is collected rather than lost.

One naming collision worth knowing: the npm package `@three-ws/mcp-server`
([docs](./mcp.md)) also ships a tool called `forge_free`. That is a different
server with its own default (`draft`, stated in its own tool schema). The
default described here is the one for `https://three.ws/api/mcp-studio`.

### Response shape

Each successful call returns `structuredContent` carrying only what a client
needs to display the model — no internal identifiers:

```json
{
  "kind": "model",
  "glbUrl": "https://three.ws/cdn/creations/…/model.glb",
  "viewerUrl": "https://three.ws/viewer?src=…",
  "arUrl": "https://three.ws/api/ar?src=…&title=…",
  "format": "glb",
  "prompt": "a friendly round robot mascot, glossy white plastic",
  "referenceImageUrl": "https://three.ws/cdn/creations/…/model-ref.png"
}
```

`referenceImageUrl` is the concept image the generator paints first and then
sculpts into 3D (the forge's image-generation step). The inline widget uses it
as the model-viewer poster so the painted view shows while the GLB streams in,
and the result narration links it for non-widget clients.

`arUrl` is the one-tap place-in-your-room link (see [AR in ChatGPT](./chatgpt-ar.md)).
Rigged avatars additionally carry `irlUrl`, the living-agent handoff into
[IRL](./irl.md), and the inline widget's AR button becomes **Bring it to life**.
Every result also includes a `spatial` field, the open Spatial MCP artifact
(`specs/SPATIAL_MCP.md`) so any Spatial-MCP renderer can display the model.

### Links for agents that render no widget

ChatGPT and Claude draw the viewer widget from the camelCase fields above. An
agent with a browser and a file system instead (Grok Bot, the xAI Responses API,
a scripted MCP client) sees only the JSON and the text, so every result that
carries a model also carries four plain, absolute links under fixed snake_case
names:

| Field | What it is | Use it to |
|---|---|---|
| `viewer_url` | `https://three.ws/viewer?src=<glb>&title=<title>`, the interactive viewer | open the model in any browser, or hand the user a link |
| `glb_url` | the model file itself | download it, re-host it, feed it to `rig_mesh` or `look_at_model` |
| `poster_png_url` | `https://three.ws/api/render/glb?glbUrl=<glb>&width=1024&height=1024`, a rendered 1024 px PNG (CDN-cached for a day) | attach a picture to a reply, a card or a markdown image |
| `embed_html` | the paste-ready snippet from the [embedding guide](./embedding.md): `<agent-3d>` for an avatar, rigged model or persona, `<model-viewer>` for a prop, each with its script tag pinned to a version and integrity hash | put the model on a web page |

The same four lines open the text content, so a client that ignores
`structuredContent` reads them first:

```text
Generated a 3D model (GLB).
Viewer: https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fcreations%2F…%2Fmodel.glb&title=a%20red%20ceramic%20teapot
GLB: https://three.ws/cdn/creations/…/model.glb
Poster PNG: https://three.ws/api/render/glb?glbUrl=https%3A%2F%2Fthree.ws%2Fcdn%2Fcreations%2F…%2Fmodel.glb&width=1024&height=1024
Embed HTML: <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js" integrity="sha384-…" crossorigin="anonymous" ></script> <model-viewer src="https://three.ws/cdn/creations/…/model.glb" alt="a red ceramic teapot" camera-controls auto-rotate ar shadow-intensity="1" style="width:100%;height:420px" ></model-viewer>
Place it in your room (AR, open on a phone): https://three.ws/api/ar?src=…
```

Which tools carry them:

- **Generation**: `forge_free`, `text_to_avatar`, `mesh_forge`, `rig_mesh`,
  `forge_avatar`, `refine_model`, and `check_job` once the job is done.
- **Inspection**: `look_at_model`, for the model it rendered.
- **Catalog**: `search_catalog` puts the four on every prop and character in
  `items` (and under each item's line in the text); `get_catalog_item` and
  `get_item_source` put them at the top level of `structuredContent`. Motion clips
  are JSON animation data, not models, so they carry none.
- **Personas**: `create_agent_persona`, `get_agent_persona` and `persona_say`,
  for the persona's body (alongside its `embed_url`, the living-body embed).

A catalog character larger than the renderer's 10 MB ceiling gets its published
PNG thumbnail as `poster_png_url`, so the link always answers with an image. The
links are built by [`api/_mcp-studio/asset-links.js`](../api/_mcp-studio/asset-links.js),
and the embed markup is the same code `get_item_source` emits
([`api/_lib/asset-snippets.js`](../api/_lib/asset-snippets.js)).

A job that is still rendering has no GLB yet, so a pending result carries no
`glb_url`, `poster_png_url` or `embed_html`. It carries a `viewer_url` of the form
`https://three.ws/viewer?job=<jobId>` instead: that page polls the job itself,
shows how long is left, and opens the model the moment it lands (the address bar
then holds the ordinary `?src=` link). An agent can hand that link to its user
straight away rather than waiting.

### Pending generations (`check_job`)

A detailed model can take longer than a single tool call should block for. When
that happens the generating tool does **not** fail: it returns a success result
carrying a pollable handle, and the job keeps running server-side.

```json
{
  "status": "pending",
  "jobId": "f1.eyJwIjoiZ2NwIiw…",
  "pollUrl": "https://three.ws/api/gpt-forge?job=f1.eyJwIjoiZ2NwIiw…",
  "viewer_url": "https://three.ws/viewer?job=f1.eyJwIjoiZ2NwIiw…",
  "stage": "mesh",
  "etaRemainingSeconds": 42,
  "prompt": "a friendly round robot mascot, glossy white plastic"
}
```

`stage` names which half of the pipeline is still running, `mesh` or `rig`, so a
client that collects the job knows whether the GLB it gets back is a bare mesh
still to be rigged or the finished rig. It carries no identifier, so it costs the
data-minimization rule nothing.

`etaRemainingSeconds` is the live estimate for the lane actually running the job
(its typical duration minus time already elapsed), so the assistant knows how
long to wait rather than retrying blind. Call `check_job` with that `jobId` to
collect the result:

- **done**: returns the ordinary success envelope (`glbUrl`, `viewerUrl`,
  `arUrl`, the four [agent links](#links-for-agents-that-render-no-widget), …)
  and the model renders inline in the widget, exactly as if the original call had
  finished in time.
- **still rendering**: returns a fresh `pending` envelope with updated
  `etaRemainingSeconds`. Call again after the suggested wait.
- **failed**: returns a clean, actionable error.

A check that fails while the job itself is fine (the status check timed out, or
its rate bucket is busy) comes back with `retryable: true`. The first check of a
finished job saves the model and scores it, which can take 20 to 30 seconds, so
checking again usually returns the model at once. Only an unrecognized `job_id`
is final.

A pending `refine_model` result also carries a `refine` object: the version
history the new model joins. Pass it back to `check_job` unchanged
(`{"job_id": "…", "refine": {…}}`) and the finished model comes back as a
refinement with its `lineage`, exactly as if `refine_model` had finished inline,
so the version strip survives the wait. A pending `forge_avatar` mesh carries
`"next": "rig"`: once it lands, run `rig_mesh` on it to finish the avatar.

`check_job` never modifies an existing model, but its first check of a finished
job writes one (it saves the GLB and records the creation), so it is annotated
`readOnlyHint: false`. It does not consume generation quota, so collecting a
model can never be rate-limited by the generation that created it.

**The inline widget collects pending jobs itself.** When the host exposes
`window.openai.callTool` (ChatGPT does), the model viewer polls `check_job`,
shows a live elapsed timer, runs `rig_mesh` when the envelope says
`"next": "rig"`, passes `refine` back so the version strip survives, and saves
the finished model to widget state so reopening the conversation shows it
instead of waiting again. A host without widget tool calls gets a designed
"still rendering" panel instead.

#### The ChatGPT call budget

ChatGPT ends any tool call still open at 60 seconds, and that limit is not
configurable. A generation takes one to four minutes, so on
`/api/mcp-chatgpt` every call runs under `CHATGPT_CALL_BUDGET_MS` (40 seconds,
[`api/_mcp-studio/dispatch.js`](../api/_mcp-studio/dispatch.js)): the prompt
director, the submit and the inline wait all shrink to fit it, and a model
still rendering at the deadline comes back as the pending envelope above for
the widget to finish. A submit always gets an 8-second floor, since there is
nothing to hand back without an accepted job, and the budget leaves room for it
under the host's limit. `/api/mcp-studio` keeps the long inline wait (up to
three minutes), because other MCP hosts wait for it.

Any HTTP client can poll `pollUrl` directly instead; it is the same public,
auth-free job handle the [3D API](/docs/3d-api) hands anonymous callers.

### Conversational refinement (`refine_model`)

Iterate on a model by describing the change in words — *"make it metallic"*,
*"bigger helmet"*, *"add wings"*. It's a REAL anchored re-generation, never a fake
diff: the prior prompt is carried forward and folded with your change
(`composeRefinement`), and an optional `reference_image_url` of the current model
anchors the regeneration as image→3D. Text-guided refinement needs only
`glb_url` + `instruction`; passing `parent_prompt` lets the change build on the
original spec instead of starting over.

Every refinement is appended to an immutable **version lineage** returned in
`structuredContent.lineage`. The client passes that array back as `parent_lineage`
on the next call to extend the same thread, or targets an earlier version with
`parent_index` to **branch**. Reverting is a pointer move over the array — no
mutation. The inline viewer renders the lineage as a version strip you can click
to cross-fade between versions.

```json
{
  "kind": "refined model",
  "glbUrl": "https://three.ws/cdn/creations/…/v1.glb",
  "viewerUrl": "https://three.ws/viewer?src=…",
  "format": "glb",
  "prompt": "a friendly round robot mascot, glossy white plastic, metallic and gold",
  "instruction": "make it metallic and gold",
  "activeIndex": 1,
  "lineage": [
    { "index": 0, "parentIndex": null, "glbUrl": "…/origin.glb", "label": "Original", "active": false },
    { "index": 1, "parentIndex": 0, "glbUrl": "…/v1.glb", "label": "make it metallic and gold", "instruction": "make it metallic and gold", "active": true }
  ]
}
```

The same `refine_model` capability is available on the paid stdio MCP server
(`3d-agent-local`, $0.25 USDC per call) via the shared lineage core, so iteration
behaves identically on both tracks.

## Embodiment — a living agent body

Three additional free tools turn a generated avatar into a **persistent, living
agent body** that renders inline in the chat: it lip-syncs each reply, shows the
matching expression and gesture, idles between turns, and returns as the same body
across sessions. A persona is a name and a 3D body — nothing about tokens, wallets,
or payments.

| Tool | Title | Input | Returns |
|---|---|---|---|
| `create_agent_persona` | Save a rigged model as a living, persistent agent body | `glb_url`, `name`, `voice?`, `source_prompt?` | `persona_id` + inline living body (idle) |
| `get_agent_persona` | Reload a persona by id (continuity across sessions) | `persona_id` | the same body + turn count |
| `persona_say` | Speak a reply through a persona: lip-sync + emotion + gesture | `persona_id`, `text`, `emotion?` | the body performing the reply |

Annotations: `create_agent_persona` and `persona_say` are writes
(`readOnlyHint:false`); `get_agent_persona` is a pure read (`readOnlyHint:true`,
`idempotentHint:true`). `create_agent_persona` carries `openWorldHint:true`
because it fetches the GLB you hand it from wherever it lives before taking a
durable copy; `get_agent_persona` and `persona_say` touch only three.ws's own
store, so both are `openWorldHint:false`.

**How it renders.** In ChatGPT (Apps SDK), each persona tool points its tool-level
`_meta["openai/outputTemplate"]` at the registered
`ui://widget/three-studio-persona.html` widget, which reads the tool's
`structuredContent` and mounts the hosted embodiment page (a result-level template
on an inline artifact is ignored by the Apps SDK, so the tool-level link is what
makes the body appear). In every other MCP host the tool result carries an inline
`text/html` resource that frames the same hosted page,
`https://three.ws/embodiment/embed`, with the
persona id and the turn's speak/emotion payload as query params. That page mounts
`EmbodimentStage` (Three.js), which rides the platform's universal
canonicalize/retarget pipeline so the baked idle + gesture clip library drives any
humanoid rig. Emotion is detected from the reply text (or set explicitly via
`emotion`) and blended onto the face **and** an upper-body gesture; lip-sync is
best-first — an Audio2Face viseme track synced to TTS audio when present, else a
deterministic text-timed mouth envelope.

**Graceful states, never a frozen pose.** A rig with no facial morphs still
animates its mouth from the jaw (or head) bone. A model that can't be
skeleton-driven — no skin, or a non-humanoid prop — is detected up front
(`decideRigMode` / `AnimationManager.supportsCanonicalClips()`) and falls back to a
gentle alive-idle with a designed note, never a bind-pose T-pose.

**Continuity.** The persona is persisted (durable GLB copy + a small identity
record) and addressed by an unguessable `persona_id` — that id is the whole
capability, so a fresh session reloads the exact same body with no sign-in. When
the embed is opened with only an id (no inline `glb`), it resolves the durable body
via `GET /api/mcp3d/persona?id=persona_…`, which returns the public projection
(name, GLB, turn count) — never storage keys or owner ids.

```json
{
  "persona_id": "persona_9f3aK2…",
  "name": "Nova",
  "glb_url": "https://three.ws/…/nova.glb",
  "emotion": "joy",
  "intensity": 0.7,
  "gesture": "av-celebrating",
  "turn_count": 3,
  "status": "spoken"
}
```

The same three tools ship on the paid stdio MCP server (`3d-agent-local`) so
embodiment behaves identically on both tracks; both drive the one hosted embed.

## Funding & limits

Generation is **operator-funded**: the platform's server-side keys cover provider
cost, so the ChatGPT user pays nothing, at any tier. Routing is **free-first**: no
backend is pinned, and the health-aware router in `api/gpt-forge.js` prefers the
free lanes (self-hosted TRELLIS, NVIDIA NIM text→3D, Hugging Face Spaces
image→3D), so in the normal case the platform's marginal cost per generation is
zero. The platform-keyed Replicate lane stays in the chain as a failover rung
rather than being excluded, so a free-lane outage degrades to a slower or
costlier engine instead of failing the user's request. Either way the cost lands
on the platform and never on the caller: no key, no account, no payment surface.

The endpoint still enforces real per-caller abuse protection
(`api/_lib/rate-limit.js`, numbers in its `STUDIO_LIMITS`). The caller is a
verified [install token](#connector-url-for-cloud-agents-install-tokens) when the
connector URL carries one, else the door's own per-user identity, else the IP:

- **Burst:** 4 generations / minute / caller
- **Hourly:** 30 generations / hour / caller
- **Install tokens:** on any door, `?install=<token>` keys the caps (and the
  transport cap) on the token. Minting is capped at 10 / hour / IP.
- **ChatGPT users:** every ChatGPT user reaches `/api/mcp-chatgpt` from OpenAI's
  shared egress IPs, so there the burst and hourly caps key on the anonymized
  per-user `openai/subject` ChatGPT sends with each tool call. On `/api/mcp-grok`
  they key on the `Mcp-Session-Id` the server issues. Whenever the caller is not
  the IP (token, subject or session), one IP is still held to 300 generations /
  hour in total. Without any of them the caps key on the IP as above.
- **Persona writes:** 20 / minute / IP (`create_agent_persona`, `persona_say`;
  `get_agent_persona` is a read and rides the transport cap)
- **Transport:** 300 requests / minute / IP (discovery, never throttled by the
  generation quota)
- **Platform-wide breaker:** a global cap across every free-studio caller,
  backstopping the shared GPU budget when many distinct IPs, each individually
  under the hourly cap, would collectively drain it

The generation quota is charged only when a request actually calls a generation
tool, so `initialize`, `tools/list`, `resources/list`, and `check_job` are never
throttled by it.

A capped generation answers HTTP 200 with a JSON-RPC error, because MCP clients
pass that message to the model while many drop a 429 body. `Retry-After` and the
`RateLimit-*` headers are still set. The message names the limit, when it resets
and how to lift it:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "error": {
    "code": -32000,
    "message": "Rate limited: the free 3D studio allows 4 generations per minute for your IP address, and that limit is used up. It resets at 2026-10-08T19:30:38.140Z (in 55 s). Lift it with a free install token: POST https://three.ws/api/mcp-studio/install (no account, no key) and reconnect at https://three.ws/api/mcp-studio?install=<token>, which gets its own budget. Or sign in at https://three.ws/api/mcp-3d (OAuth 2.1), metered per account.",
    "data": {
      "reason": "rate_limited",
      "limit": "generation_burst",
      "max": 4,
      "window": "1 m",
      "keyed_on": "ip",
      "reset_at": "2026-10-08T19:30:38.140Z",
      "retry_after": 55,
      "remedy": {
        "kind": "install_token",
        "install_endpoint": "https://three.ws/api/mcp-studio/install",
        "connector_url": "https://three.ws/api/mcp-studio?install=<token>"
      }
    }
  }
}
```

`data.limit` is one of `generation_burst`, `generation_hourly`,
`generation_ip_pool` and `generation_global`; `data.keyed_on` is `install`,
`session`, `chatgpt_user`, `ip` or `platform`. A caller that already holds a
token, or hits the per-IP pool or the platform-wide breaker, gets
`remedy.kind: "account"` with `oauth_server` instead, since a new token would
not help. The transport cap (300 requests a minute) still answers HTTP 429 with
the same `reset_at` and `remedy` fields.

Because the lanes are zero-cost, the **per-IP** caps **fail open** if the
rate-limiter backend has an outage: a Redis blip must never dead-end a free
feature (the same posture as the paid server's own free lane). The platform-wide
breaker is the deliberate exception and **fails closed** in production, since a
limiter outage is exactly when an unbounded global spend would do real damage.
Any accidental paid-lane spend is still fail-closed one layer further down in
`/api/gpt-forge` (the ChatGPT-dedicated clone of `/api/forge`; see the note under
Environment).

## Safety

Generation prompts are screened for age-13+ appropriateness before any provider
work (`api/_mcp-studio/safety.js`): sexual/adult, child-sexual, graphically
violent, hateful/extremist, and real-weapon/drug prompts are refused with a
clear message. Stylized fantasy props (a sword, a wand) are allowed.

## Environment

All optional — sensible production defaults:

| Var | Default | Purpose |
|---|---|---|
| `STUDIO_API_BASE` | request origin → `PUBLIC_APP_ORIGIN` → `https://three.ws` | Origin to call `/api/gpt-forge` on |
| `STUDIO_FORGE_TIMEOUT_MS` | `180000` | Generation poll budget |
| `STUDIO_RIG_TIMEOUT_MS` | `180000` | Rig poll budget |
| `STUDIO_REFINE_TIMEOUT_MS` | `180000` | `refine_model` poll budget |
| `STUDIO_POLL_MS` | `3000` | Starting poll interval |
| `STUDIO_POLL_MAX_MS` | `10000` | Ceiling the poll interval backs off to |

Generation runs on `/api/gpt-forge` (`api/gpt-forge.js`), the ChatGPT-dedicated
exact clone of `/api/forge`: same lanes, tiers, job tokens, and `forge_creations`
rows, cloned so the ChatGPT pipeline can be tuned without touching the forge or
any surface that rides it. The agent-facing REST endpoints (`/api/3d/generate`,
`/api/v1/ai/text-to-3d`) stay on `/api/forge`.

The inline widget loads Google's `<model-viewer>` from one pinned URL in
[`api/_lib/model-viewer-cdn.js`](../api/_lib/model-viewer-cdn.js), which is also
the origin the widget's `openai/widgetCSP` allowlists, so the script tag and its
CSP entry cannot drift apart. That module pins the one build every three.ws
surface loads, so a host page that already has a three.ws embed reuses the same
module instead of registering a second, conflicting custom element. The
standalone [`/viewer`](../public/viewer.html) page and the Vite-bundled
first-party pages ship the same version and differ only in how they fetch it:
a top-level document can carry an SRI hash, a template-interpolated embed and a
runtime CDN failover chain cannot. The header comment in
`api/_lib/model-viewer-cdn.js` names all three delivery rungs, and
`npm run check:model-viewer` fails the build if one of them drifts off the
shared version. The `/api/ar` launcher no longer inlines a
`<model-viewer>` of its own: Android gets a Scene Viewer intent, and every other
device (and every live avatar) is sent on to `/ar/view`, a Vite-bundled page
that generates a real USDZ from the GLB on the device so iPhone gets genuine
Quick Look rather than a camera overlay (`api/_lib/ar-launch.js`).

## Related

- [MCP overview](/docs/mcp) - every three.ws MCP surface, paid and free
- [AR in ChatGPT](/docs/chatgpt-ar) - how `arUrl` and the AR launcher work on ChatGPT surfaces
- [3D API](/docs/3d-api) - the free REST lane the studio tools run on
- [API Reference](/docs/api-reference) - the `/api/3d/studio` custom GPT Actions contract
- [Prompt library](/docs/prompts) - ready-made prompts that drive these tools, at [three.ws/prompts](https://three.ws/prompts)
