---
title: "From a 3D connector to a physical-world API: what we shipped after the ChatGPT 3D Studio app"
venue: OpenAI Developer Community (community.openai.com)
account: nichxbt
category: API (Apps SDK / Actions / MCP)
tags: [chatgpt, apps-sdk, mcp, actions, 3d, agents]
description: "A long technical follow-up on the three.ws 3D Studio connector: the fourteen keyless MCP tools, the surfaces we built on top of them, the 72-server MCP fleet behind them, the partner programmes that power it, and the design principles we use for tools that spend money and touch physical objects."
status: draft, not yet posted
---

# From a 3D connector to a physical-world API: what we shipped after the ChatGPT 3D Studio app

_Forum post for the [OpenAI Developer Community](https://community.openai.com), posted from the nichxbt account. Category: API (Apps SDK / Actions). First person, technical, no marketing voice. Every URL in this post is live, and every endpoint marked free is keyless: you can paste the curl commands into a terminal right now and get a real answer. three.ws is an OpenAI Select Partner in the OpenAI Partner Network: an independent member at the Select tier, not an OpenAI product, and not endorsed by OpenAI beyond the partner designation._

---

Hi everyone. Some months ago I wrote up how we brought [three.ws](https://three.ws) 3D Studio into ChatGPT twice: once as an Apps SDK connector over MCP, and once as a custom GPT over Actions. If you missed it, the short version is that you can type "a small ceramic robot figurine" into ChatGPT and a minute later you are turning a real, textured 3D model around in the conversation, then placing it on your desk in AR.

A lot of you tried it, asked good questions, and sent us ideas. Thank you. This post is the follow-up, and it is written for two kinds of reader at once.

If you are new to 3D or to MCP, the first few sections explain what we built in plain terms: what each tool does, why it exists, and how to try it with one copy-paste. If you build tools for assistants yourself, the middle and end of the post go deep on the design choices, the wire formats, and the open-source packages you can lift into your own work.

Here is the idea that ties it together. Once an assistant can call a tool that produces a real 3D asset, a whole set of genuinely interesting design questions opens up:

- How should a tool behave when it spends the user's money?
- How should a tool behave when it moves an object in the physical world, like a 3D printer or a front door lock?
- How does an agent work with a `.glb` file, which is built for renderers rather than language models?
- How do you tell an agent that a tool is ready to act right now, beyond telling it the server is up?
- And once you publish dozens of tool servers, how does a client find the right one?

We have shipped an answer to each of the five, and I want to write them down properly, because they generalise well beyond 3D. Everything below is open source (Apache-2.0) and readable at [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws).

**Short version:** the free connector has grown to fourteen tools and is still keyless. On top of it we added a vision tool so the model can look at its own output, a ready-made asset catalog so it can reuse before it generates, a physics grade so a simulator knows an asset is usable, a manufacturing API so an agent can order a physical print of what it just generated, a home-control MCP server whose physical actions are reserved for surfaces where a real person approves them, an open CC0 response shape for 3D results, and a set of health primitives that answer "can this agent act right now". Behind all of it sit 72 MCP servers in the official registry and 91 npm packages, and the partner programmes that power the stack get their own section near the end.

**If you only have two minutes**, here is the friendliest way in:

1. In ChatGPT, add the connector `https://three.ws/api/mcp-studio` with **No authentication** (or open the "three.ws 3D Studio" custom GPT if your plan does not do connectors).
2. Ask for something small and specific, like "a ceramic owl with a teal glaze". A rotatable model appears inline, usually within a minute, with a preview image while you wait.
3. Ask the assistant to "look at it and make the ears bigger". It renders the model, sees it, and calls `refine_model`, and each version keeps its own AR link so you can place every iteration on your desk and compare.

No account, no key, and no payment at any step. Everything after that is optional depth: rigging the model, giving it a personality and a voice, embedding it on your own site, or having it printed in nylon and shipped to you. The rest of this post walks through each of those, and through the design decisions that make them safe to hand to an agent.

**Contents**

1. Where things stand on the two ChatGPT surfaces
2. Designing tools that spend money and move matter
3. `look_at_model`: letting the agent see its own output
4. Simulation readiness: a grade a physics engine can act on
5. Materialize: when the tool call ends in a cardboard box
6. `home-mcp`: consent that only a real person can give
7. Spatial MCP: a 3D scene as a native tool result
8. "Can it act?" as a first-class health question
9. Where the model goes after the chat: embedding and animation
10. The fleet: 72 servers, and how a client finds the right one
11. Your coding agent has a face now
12. The whole surface, in tables
13. Our partners, and how each one shows up in this stack
14. What I would like this forum's opinion on

---

## 1. Where things stand on the two ChatGPT surfaces

### The connector (Apps SDK / MCP)

`https://three.ws/api/mcp-studio`, Streamable HTTP, MCP protocol `2025-06-18`, no auth. It is deliberately scoped to 3D only: no wallet, no payments, no token, so a reviewer can understand the whole surface at a glance. `GET` is intentionally not offered (there is no server-initiated stream), every request is answered synchronously over `POST`, and `OPTIONS` is handled for CORS. Ask it what it has:

```bash
curl -s https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Fourteen tools, as of today, all free and keyless:

| Tool | What it does |
|---|---|
| `forge_free` | text to a textured GLB, with an optional `tier` of `draft`, `standard` (the default), or `high` |
| `text_to_avatar` | text to a rigged humanoid, skinned, with 52 ARKit blendshapes |
| `mesh_forge` | image or sketch to an art-directed mesh |
| `rig_mesh` | add a humanoid skeleton to a static GLB you already have |
| `forge_avatar` | photo or prompt to a rigged, animation-ready avatar |
| `refine_model` | iterate on a previous result by describing a change; every refinement is its own version with its own AR link and lineage |
| `check_job` | collect a generation that outran the tool call |
| `look_at_model` | render a model to images the assistant can actually see (section 3) |
| `search_catalog` | search the ready-made library: CC0 props, rigged characters, motion clips |
| `get_catalog_item` | read one catalog entry |
| `get_item_source` | paste-ready code for an entry: an `<agent-3d>` tag pinned to a release with its integrity hash, `<model-viewer>`, three.js, or React |
| `create_agent_persona` | give a rigged body a name and a personality |
| `get_agent_persona` | read one back |
| `persona_say` | make it say a line, with real lipsync, on a living page |

The three catalog tools are the newest addition and they change the shape of a conversation in a nice way: before spending a minute of GPU time, the assistant can check whether three.ws already publishes a lamp, a chair, or a waving animation, and hand back code that works immediately. They never count against the generation quota.

The `high` tier runs on our own self-hosted Hunyuan3D GPU worker for denser geometry, and the default `standard` tier is served by whichever free engine the router picks for the prompt, typically our self-hosted TRELLIS worker. Every tier is platform-funded, so the caller stays anonymous and keyless at every level of quality.

Each generation tool renders inline through an Apps SDK widget (`ui://widget/three-studio-model.html`) with a rotatable viewer and a **View in your space** button for AR. If the result is rigged, the response also carries an `irlUrl` and the button becomes **Bring it to life**. The persona tools render in their own widget (`ui://widget/three-studio-persona.html`).

We also serve a second front door for the ChatGPT directory specifically, `https://three.ws/api/mcp-chatgpt`, which advertises the eight 3D tools and the model viewer. Both doors share one handler and one generation quota, and a single `SURFACES` definition in `api/_mcp-studio/dispatch.js` decides what each one advertises, so the two can never disagree.

One configuration detail is worth sharing because it makes the inline viewer work beautifully in production: the widget's `openai/widgetCSP` allowlist names exactly two origins, `https://three.ws` and the model-viewer CDN. Every off-origin GLB is re-served through our own `/api/glb` proxy and every poster image through `/api/img`, so the CSP stays tight, contains no wildcards, and every model loads in real ChatGPT exactly as it does in a local harness. If you build a widget that renders remote assets, routing them through your own origin is the pattern I would recommend.

### The custom GPT (Actions)

Same free lane as plain REST, for people whose plan does not do connectors. OpenAPI 3.1 is served at `https://three.ws/.well-known/3d-studio-openapi.yaml` and imported by URL rather than pasted inline, which keeps the GPT on exactly the contract we serve, every time.

```bash
curl -s -X POST https://three.ws/api/3d/studio \
  -H 'content-type: application/json' \
  -d '{"prompt":"a small ceramic robot figurine"}'
```

Submit never blocks. It answers `pending` with a `poll` path that already carries the job handle and title, an `etaSeconds`, a `watchUrl` the user can open (it shows the concept art and a real countdown and opens the finished model by itself), and frequently a `previewImageUrl`, because our text-to-3D path goes through an intermediate image and it is a lovely thing to show. The GPT shows that image as markdown while it waits. It is a small touch and it makes the minute feel like fifteen seconds.

The poll endpoint returns `429` with a `retry_after` if the model polls too quickly, and the GPT's instructions tell it to honour that and keep the user posted on progress. The result is a calm, accurate conversation from prompt to finished model.

The Actions lane also carries an age-13-plus safety gate and store-clean responses (model URLs and job state only), and AR rides both ChatGPT surfaces through the same `arUrl` contract and device-aware launcher.

---

## 2. Designing tools that spend money and move matter

A read-only tool is simple to reason about: it either returns something useful or it does not. A tool that spends money or moves matter deserves a richer design, and MCP's annotation vocabulary (`readOnlyHint`, `destructiveHint`, `openWorldHint`) is a great starting point for it. Annotations tell the client what a tool is. Server-side rules decide what the tool does.

We design every such tool around four rules.

**Rule 1: the refusal lives on the server.** A guard written into the API holds for every client, ours and everyone else's. In our smart home tools, a household member with the `guest` role cannot approve unlocking a door, and that rule is enforced by the server, so no client could ever offer the button. We write the refusal into the API first and the interface second, deliberately.

**Rule 2: every check runs before any charge.** Our [Knock](https://three.ws/knock) surface lets someone pay to get one message to a person they do not know. Price (anything from $0.001 to $1,000, or a free door), daily cap, message length, and block list are all evaluated **before** any payment is attempted, so every paid knock is a knock that lands. A priced door also cannot be opened without a payout address: the API checks that first too.

**Rule 3: a tool that makes a physical object gets a content gate that can say no.** Our [Materialize](https://three.ws/materialize) lane turns a generated model into a real printed object shipped to an address. It screens and refuses weapons, functional key duplicates, and third-party brand marks before anything reaches production. A print bureau puts a person at that checkpoint. When an agent is the buyer, the checkpoint is code, and we built it that way from day one.

**Rule 4: keep the free surface and the paid surface on different servers.** Not a flag, not a scope: different origins with different code. Our free 3D server has no payment code in it at all. Not disabled, absent. A reviewer can verify that in a minute, and so can we, forever. The paid sibling lives at `/api/mcp-3d`, authenticated by OAuth 2.1 or paid per call over HTTP 402, and shares none of the free server's surface.

We read OpenAI's review guidelines on commerce as a design spec rather than a compliance checklist, and the principle we take from them is simple: every paid call is clearly presented as paid, up front, before anything happens.

Annotations are part of that honesty too. Our six generators carry `readOnlyHint:false`, `destructiveHint:false`, `idempotentHint:false`, and `openWorldHint:true`, because they run against external model APIs and never modify or delete anything. `check_job` is annotated as not read-only and not idempotent, because the first check that finds a job finished materializes the creation (copying the model into our storage, recording it, running the quality gate). `look_at_model` is genuinely read-only and idempotent. Accurate annotations let a client make good decisions on the user's behalf.

---

## 3. `look_at_model`: letting the agent see its own output

A `.glb` is a binary format built for renderers. A person opens it in a viewer and sees the model instantly. A language model needs it translated into its own modality, and once it has that, generation becomes a loop instead of a single shot.

`look_at_model` renders the model from several angles and returns the frames as **MCP image content blocks**, so a multimodal client renders them straight into the conversation and the model looks at the thing it made. You can ask for up to six views (`front`, `three-quarter`, `side`, `back`, `top`, `bottom`; the default is three-quarter, front, side, back) at 128 to 1024 pixels. Alongside the frames it returns geometry facts (triangle count, bounds, material and texture counts, whether it is skinned) and a plain-language reading of them.

Three ways in, depending on what you are:

| You are | Use | You get |
|---|---|---|
| An MCP client | tool `look_at_model` on `/api/mcp-studio` | frames as MCP image blocks, rendered inline |
| A Node program | [`@three-ws/see`](https://www.npmjs.com/package/@three-ws/see) | `see(url)` gives views, stats, notes |
| Anything with HTTP | `POST /api/3d/look` | JSON with a frame URL per angle |

```bash
curl -s -X POST https://three.ws/api/3d/look \
  -H 'content-type: application/json' \
  -d '{"src":"https://three.ws/avatars/cesium-man.glb"}'
```

The loop this unlocks is the whole point: generate, look, judge, call `refine_model`, look again. If you take one idea from this post, take this one: **any tool that hands an agent a binary pairs beautifully with a companion that renders it into the agent's own modality.** Ours was 3D. Yours might be a PDF, a spreadsheet, a waveform, a CAD file.

A neighbour of this that came from the same insight: [`@three-ws/glb-diff`](https://www.npmjs.com/package/@three-ws/glb-diff) and the [Model Diff](https://three.ws/diff) page, which answer "what actually changed between these two versions of the mesh" structurally rather than by eyeballing two viewers. An agent iterating on an asset gets a precise answer about what its last edit did.

---

## 4. Simulation readiness: a grade a physics engine can act on

Physics engines ask more of a mesh than renderers do. A rigid-body solver in MuJoCo or Bullet wants a closed surface, consistent winding, positive volume, and real-world units, so it can compute mass and behave the way the object would in the world. Generators often fit a model to a unit box, so knowing the intended size is part of the answer too.

So we published a grade, free and keyless:

```bash
curl "https://three.ws/api/sim-readiness?src=https://three.ws/avatars/cesium-man.glb"
```

```jsonc
{
  "verdict": "simulation_ready",
  "blockers": [],
  "warnings": ["skinned_geometry_graded_at_bind_pose"],
  "grader": "threews.sim.readiness.v1",
  "glbSha256": "b7001eaeea8254bd…"
}
```

Four verdicts, and the distinction between the middle two is the useful part:

| Verdict | Meaning | What you do |
|---|---|---|
| `simulation_ready` | Closed surface, consistent winding, positive volume, real-world extents | Use it as a rigid body, and trust the reported mass |
| `needs_scale` | Geometry is sound, only the units are missing | Multiply to the intended size; mass properties scale with it |
| `needs_repair` | Open, non-manifold, or inconsistently wound | Close the surface first, then grade again |
| `unusable` | No triangles, or zero volume | Choose or generate another asset |

There is a fifth value, `unreadable`, for bytes that are not binary glTF 2.0 at all, kept deliberately distinct from `unusable`: one is a file in another format, the other is a valid file with nothing to simulate.

The grade is content-addressed by the GLB's SHA-256, so the same bytes always get the same verdict and the result caches cleanly. The spec is CC0 ([`specs/SIM_READINESS.md`](https://github.com/nirholas/three.ws/blob/main/specs/SIM_READINESS.md)) and the grader is a pure function you can vendor. It is also permanently free as a tool (`grade_sim_readiness`) on our **paid** MCP server, which is a deliberate choice: keeping an assurance check free means it runs everywhere it is useful.

If you are building anything where an LLM produces assets for a simulator, a game engine, or a robotics stack, please borrow this idea even if you never touch our endpoint. A machine-readable claim about physical usability is a natural next layer for the glTF ecosystem, and we would love to see it spread.

---

## 5. Materialize: when the tool call ends in a cardboard box

[Materialize](https://three.ws/materialize) is the physical lane. Describe an object, generate it, then have it printed and shipped. The whole loop is also an API, which means an autonomous agent can order a physical object of a model it just generated, end to end.

```
  a forge creation            a GLB you upload            an agent
        │                           │                           │
        └───────────────┬───────────┴───────────────────────────┘
                        ▼
        POST /api/print/quote      printability report + itemized price
                        │          + a signed quote token (24 hours)
                        ▼
        POST /api/print/orders     human checkout
        POST /api/x402/print-order agent checkout, same pipeline
                        ▼
        safety screening ──▶ production ──▶ quality check ──▶ shipped
                        ▼
        certificate of authenticity, QR in the box
```

1. **Analysis, free and keyless.** `POST /api/print/quote` with a model returns the printability report before any price: whether the mesh is a closed solid, how many separate bodies it contains, where its holes are, its thinnest wall, its exact volume, and a 0 to 100 score with named deductions written for a person, not a slicer. Free because an agent that can check printability before paying to generate spends less overall.
2. **Preparation.** `POST /api/print/prepare` reconstructs the mesh as a solid, fills its holes, scales it to the chosen height, optionally hollows it with drain holes (which is what makes a large resin print affordable), and exports binary STL, 3MF, and the repaired GLB. Full-colour materials get per-vertex colour sampled from the source texture.
3. **A signed quote token**, valid 24 hours, carrying every priced parameter inside its signature, so the price an agent was quoted is the price it pays. Every line is itemized: build setup, material with the exact cubic centimetres it was computed from, finish, quantity break, shipping.
4. **Two checkouts, one pipeline.** A human pays in the browser in USDC on Solana; an agent pays over HTTP 402. Same order record, same statuses, same fulfillment.
5. **Safety screening** before production, as described above.
6. **Provenance in the box.** Every print ships with a certificate of authenticity, attested publicly on Solana, with a QR code, so the object can show which generation produced it. Creators can cap how many copies of a model will ever exist.
7. **Order tracking at every step**: `screening`, `submitted`, `printing`, `quality_check`, `shipped`, `delivered`, each appended to a timeline at `GET /api/print/orders/:id`, so the owner always knows exactly where the order is.

The live catalog (`GET /api/print/catalog`) currently offers standard resin, tough resin, SLS nylon (PA12), full-colour sandstone, a PLA draft option, and 316L stainless steel. Each material card is measured against your specific model, and the size slider's bounds come from the mesh itself: the low end is where the thinnest wall reaches the material's minimum, the high end is where the widest axis fills the print bed. A **See it at true size** button places the object on your real floor in AR at the exact height you are ordering, because the AR scale is taken from the same number the price was computed from. Steel is quote-on-request: it is priced as an estimate for an engineer to confirm, rather than through instant checkout.

The design principle for tool authors: **an irreversible tool deserves a free, honest dry run in front of it.** Quote is free, detailed, and refusable. Order is the only call that costs anything, and by then every question has already been asked and answered by a machine that could still change its mind.

---

## 6. `home-mcp`: consent that only a real person can give

This is the surface I would most like feedback on, because I think the pattern generalises past homes.

[three.ws Home](https://three.ws/smart-home) connects an agent to a real house through [Home Assistant](https://www.home-assistant.io), which already owns the device layer (1,500-plus integrations covering Zigbee, Z-Wave, Matter, Thread, BLE and the long tail, around 90k stars) and speaks MCP natively through its `mcp_server` integration. We wrote no device code at all. What we add is the face: a 3D presence that stands in a live model of your home, reacts to it, and talks to you.

We also published [`@three-ws/home-mcp`](https://www.npmjs.com/package/@three-ws/home-mcp), five tools that let any MCP assistant read the house, list entities, list the scenes the household already built, run one, and call a service:

```bash
claude mcp add home \
  -e HOME_ASSISTANT_URL=https://example.ui.nabu.casa \
  -e HOME_ASSISTANT_TOKEN=... \
  -- npx -y @three-ws/home-mcp
```

Every call that would open the house passes through a physical-action gate, and **over stdio that gate declines by design.** The reasoning: a stdio MCP server has no user-visible surface of its own and no session in which a person can be shown a request and approve it. So physical actions like unlocking are reserved for surfaces where a real person sees a real prompt, and the local server tells the assistant clearly what it will do instead and why. The gate has one implementation, shared with [`@three-ws/home-bridge`](https://www.npmjs.com/package/@three-ws/home-bridge), so both enforce exactly the same rule.

Adjacent decisions from the same wave, since they all answer the same trust question:

- **Households and five roles** (`owner`, `admin`, `member`, `guest`, `viewer`), each stating in plain language, at the moment you pick it, what it can do. A member who lives there can confirm a guarded action; a guest can turn on lights and is never asked to approve unlocking anything. Scoped guests and viewers receive only the rooms they were given: the others are **removed from the payload**, not hidden in the UI, so their client only ever knows about the rooms they were invited into. Invitations work once, expire after a week, and can be withdrawn. Removing someone revokes every standing allowance they ever approved, in the same instant. Every action in the home log names the person who took it. Exactly one owner per home is a schema fact, enforced by a partial unique index.
- **A relay for houses on a home network**, which is the default Home Assistant install. The house dials us over one outgoing WebSocket; we never dial the house, no port is forwarded, no tunnel daemon runs, and **we never receive a Home Assistant token**, because the integration mints its own credential locally and it stays in the building. The threat model is published.
- **Voice**, hands-free, live at [/voice/home](https://three.ws/voice/home), built on silero VAD and openWakeWord running on the listener's own machine. Confirming a physical action requires an intentional utterance, so a background "yeah" picked up from the room is never treated as approval.
- **A Home Assistant voice satellite can wear the agent's face**, so the assistant already in the kitchen gets a body rather than a speaker grille.
- **Data**: see, export, and delete everything a connected home stores, on one page.
- **Matter, measured.** We prototyped the agent as a Matter device on matter.js and published the full measurements. It commissioned into a real Home Assistant over plain IP, with no Bluetooth or Thread, in 744 ms; Home Assistant reached the agent in 328 ms and the agent reached Home Assistant in 531 ms; it ran at 73 MB of memory and 0.03% of one CPU. Most usefully, a guarded `lock.unlock` attempted through a Matter automation was held at `needs_confirmation` and the door stayed locked until a human confirmed. The measurements are published so the next step starts from data.

The car surface came out of the same design ([three.ws Drive](https://three.ws/drive)), and it is worth a sentence here because it is a pure Apps-SDK-shaped constraint problem: in a car, voice is the primary interface. iOS 26.4 added a CarPlay category for voice-based conversational apps with its own entitlement, and iOS 27 let the Voice Control template overlay other templates. The architecture follows from that: a voice-first agent whose control surface is Apple's templates and whose face lives on the phone in the cradle, the passenger display, or an open head unit. The Android Auto car app is written and compiled, and the native CarPlay scene is written in the tree, with Apple's entitlement request as the next step.

---

## 7. Spatial MCP: a 3D scene as a native tool result

Charts became first-class results in assistants because a picture of the data reads better than a link to it. 3D deserves the same treatment: a model you can turn around right in the conversation, rendered natively by the client.

[Spatial MCP](https://three.ws/spatial-mcp) is the open response shape we published for this: a renderer-agnostic, CC0 description of a 3D scene that an MCP client can render natively as a result. three.ws is the reference implementation. The validator (`validateSpatialArtifact()`, `buildSpatialArtifact()`, `lintSpatialMeta()`) and the conformance fixture corpus are published as [`@three-ws/spatial-mcp`](https://www.npmjs.com/package/@three-ws/spatial-mcp), dependency-free, and the package's own test suite runs over every fixture so the corpus and the reference validator always agree. If you would rather not write code, paste a payload into the checker on the [Spatial MCP page](https://three.ws/spatial-mcp) and read the conformance and data-minimization diagnostics directly. The live demo there renders a transformed payload beside a native three.ws artifact in the same renderer, which shows the portability in action. The shape carries no payment, wallet, or token surface at all, which keeps it easy for any client to adopt.

I would genuinely love other 3D tool authors here to adopt or fork it. A shared shape is worth more to all of us than any one version of it.

---

## 8. "Can it act?" as a first-class health question

Liveness checks answer "is the process up?", and they do it well. An autonomous agent also needs a second question answered: "can it act right now, and if not, what is the one thing to fix?" Acting depends on a chain of preconditions the process itself does not see: a current model chain, provider credit, a funded wallet, a reachable RPC, a live data feed.

So we built [agent vitals](https://three.ws/docs/agent-vitals): preconditions declared as **vitals** with `needs` edges, actions as **capabilities** that AND over them, and attestation that returns the **root** blocker rather than a symptom.

```
deploy-fresh ──> cognition ──┐
                             ├──> [enter]
armed, solvency, feed, rpc ──┘

rpc ─────────────────────────────> [exit]
```

Two properties fall out of that shape, and both are the kind of thing a single health bit cannot express:

- **`exit` deliberately depends on neither the feed nor a model.** An agent that can still close a position should be reported as able to close it, whatever the state of its reasoning lane.
- **`deploy-fresh` only feeds `cognition` for an agent that actually uses a model**, so each capability depends on exactly the preconditions it really needs.

Each vital reads a real source: `armed` reads the owner's strategy settings, `solvency` asks the executor's own sizing rule whether the wallet can fund one action, `rpc` calls `getSlot` on a Solana RPC, `feed` watches the live data stream, `deploy-fresh` reads the running image's create time, and `cognition` makes a real completion through the model chain. There is an operator CLI (`npm run agent:vitals`) and an ops-gated HTTP endpoint (`GET /api/agents/vitals`).

The engine is a framework-agnostic package with no dependencies ([`packages/agent-vitals`](https://github.com/nirholas/three.ws/tree/main/packages/agent-vitals), also on npm as [`@three-ws/agent-vitals`](https://www.npmjs.com/package/@three-ws/agent-vitals)). Nothing about it is specific to our platform, and if you run an agent fleet I think you will enjoy having it: it turns "can it act?" into a direct, explainable answer.

Two neighbours from the same line of thinking:

- [Brownout](https://three.ws/brownout) and [`@three-ws/brownout`](https://www.npmjs.com/package/@three-ws/brownout): read where an API's data came from and how fresh it is, and publish **proven** fallbacks: every fallback it lists has been executed for real, with the provider it protects against genuinely refusing, inside the same request path a user hits, and the proof receipts are on the live registry.
- [x402 Preflight](https://three.ws/preflight) and [`@three-ws/x402-preflight`](https://www.npmjs.com/package/@three-ws/x402-preflight): confirm that a paid seller can settle before signing anything.

And a third, which is a testing tool rather than a runtime one: [`@three-ws/witness`](https://www.npmjs.com/package/@three-ws/witness) records what a person actually did and compiles it into a Playwright spec that goes from red to green as the issue is fixed. A user's report becomes a runnable experiment automatically, which is exactly the part a machine does well. It works on any site, with or without the rest of our stack.

---

## 9. Where the model goes after the chat

A recurring question in the original thread was some version of "great, I generated a fox in ChatGPT, what can I do with it next?" The answer is the rest of the platform, and it is worth summarising because it is what turns the connector into a starting point for real projects.

**Embedding.** Every generated avatar is a web component. One tag on any page:

```html
<script type="module" src="https://three.ws/embed.js"></script>
<agent-3d agent="<id>"></agent-3d>
```

There are also framework and use-case wrappers: [`@three-ws/react`](https://www.npmjs.com/package/@three-ws/react), an avatar overlay that reacts to buttons and navigation, a floating concierge chat widget, a page narrator that reads the page it lives on, a walk companion that roams a corner of the screen, and a guided tour agent. All of them are paste-in snippets with no backend on your side. Versioned embed releases are pinned with Subresource Integrity hashes, which is what `get_item_source` hands back.

**Animation, which is what brings a body to life.** Our clip library works across rig conventions. Bone names are canonicalised across Mixamo, Unreal, VRM and VRoid, VRM 1.0, Daz/Genesis, MakeHuman, Blender `.L`/`.R`, and simple `shoulderL` rigs, then idle, walk and the rest are retargeted onto whatever came in, legs included. There is **no rig allowlist**: any humanoid drives the same pre-baked library, and a model that is not skeleton-driven (a prop, a non-humanoid) gets the default rig instead. That logic is published as [`@three-ws/retarget`](https://www.npmjs.com/package/@three-ws/retarget). If you have ever hand-mapped a skeleton, this is the package to borrow.

**Delivery.** [`@three-ws/avatar-stream`](https://www.npmjs.com/package/@three-ws/avatar-stream) packs a GLB into a layered progressive stream over plain HTTP, so a heavy avatar shows something correct early and refines as the rest arrives. [`@three-ws/render`](https://www.npmjs.com/package/@three-ws/render) renders rigged avatars to PNG, GIF, and truecolor terminal frames server-side, which is how the same agent shows up in a GitHub README, a Slack message, and a Windows 11 widget board.

**One command, if you want the whole thing scaffolded:**

```bash
npx @three-ws/create-agent
```

That goes from a sentence to a rigged, animated 3D agent you can embed.

**And a favourite:** [Portal](https://three.ws/portal) turns any website into a walkable 3D world by reading the page's real structure, and exposes that shape over MCP. The reason it belongs in this post: an agent that fetches a page gets the page's *shape* over Portal, which is compact enough to reason about and spatial enough to hand back as somewhere a human can actually go.

---

## 10. The fleet: 72 servers, and how a client finds the right one

This is the section I most wanted to write.

As of a footprint audit on 2026-08-25, three.ws publishes **72 MCP servers in the official Model Context Protocol registry** under one namespace (`io.github.nirholas`), and **91 packages on npm** under `@three-ws`, 39 of which are MCP servers in this repository. Every capability that felt independently useful became its own small, precise server, because a server is cheap to publish. That gives clients exactly the tool set they want, and it makes discovery a design problem worth solving deliberately. Here is how we approach it.

1. **One tightly scoped server per audience.** The ChatGPT-facing server is exactly the 3D tools and nothing else. The plugin guidelines reward tightly scoped apps, so one focused, coherent surface is the right shape for a directory, with the rest documented as direct MCP connections.
2. **One hosted server behind OAuth 2.1** (`https://three.ws/api/mcp`) that carries the whole platform for clients that want everything, with `/.well-known/oauth-protected-resource` discovery routed properly so the auth handshake works first time in every client. That public, production OAuth 2.1 server is the gating requirement for the OpenAI plugin directory, and it is already live.
3. **Typed tool authoring, shared.** Our in-repo tool SDK ([`packages/tool-sdk`](https://github.com/nirholas/three.ws/tree/main/packages/tool-sdk)) gives us `defineTool` and `defineExec`, so annotations, schemas, and error shapes are consistent across every server we ship.
4. **Publish where clients look.** Beyond the official registry, our servers are live on PulseMCP (ingested from the registry), Glama, and the LobeHub MCP marketplace, and four Claude Code plugins ship from the repo's own marketplace.

If you are about to publish your fifth MCP server, here is the question we now ask first: is this a server, or a tool namespace inside one? Answering it early keeps a fleet easy to discover.

---

## 11. Your coding agent has a face now

Not an OpenAI surface, but it is the thing developers respond to most, so it belongs here. `npx @three-ws/tty-avatar <id>` draws any three.ws avatar in colour at 24fps in a plain terminal, no browser and no GPU, using truecolor half-blocks, braille cells (2x4 dots per cell for four times the vertical detail), or a plain luminance ramp when the output is piped.

The second half is the fun part:

```bash
npx @three-ws/tty-avatar install-hooks --write
```

That merges hook entries into your coding agent's settings (leaving any you already have alone, and it is idempotent). Open two panes: viewer in one, agent in the other. The avatar looks up and thinks while the agent reads your prompt, nods while it edits and runs commands, reacts when a tool reports an error, pulses when it is waiting on you, and bounces when it finishes, with a caption saying what it is doing right now (`editing index.js`, `$ npm test`, `searching`).

An ambient face in a second pane turns out to be a wonderful progress indicator, because you read its posture without switching focus. The renderer core is separately published as [`@three-ws/tty-3d`](https://www.npmjs.com/package/@three-ws/tty-3d) if you want to draw something else.

---

## 12. The whole surface, in tables

**Free and keyless.** Paste and run.

| What | Endpoint |
|---|---|
| 3D Studio MCP, 14 tools | `POST https://three.ws/api/mcp-studio` |
| 3D Studio Actions | `POST https://three.ws/api/3d/studio` |
| Look at a model | `POST https://three.ws/api/3d/look` |
| Simulation readiness | `GET https://three.ws/api/sim-readiness?src=…` |
| Printability report and quote | `POST https://three.ws/api/print/quote` |
| Print material catalog | `GET https://three.ws/api/print/catalog` |
| Live commit and revision of production | `GET https://three.ws/api/version` |

**Paid or gated**, on separate servers from the free ones.

| What | Where | Payment |
|---|---|---|
| Full platform MCP | `https://three.ws/api/mcp` | OAuth 2.1 |
| Paid 3D studio (rig, animate, retexture, analyse) | `https://three.ws/api/mcp-3d` | OAuth 2.1 or per call over HTTP 402 |
| Print order | `POST /api/print/orders` or the 402 lane | per order |
| Reach a person | [`@three-ws/knock-mcp`](https://www.npmjs.com/package/@three-ws/knock-mcp) | the door owner's price |
| Home control | [`@three-ws/home-mcp`](https://www.npmjs.com/package/@three-ws/home-mcp) | free, gated, physical actions on human-approved surfaces |

**The footprint behind it**, from an audit dated 2026-08-25 unless noted:

| | |
|---|---|
| npm packages under `@three-ws` | 91 in this repo (101 across the wider scope at audit time) |
| MCP servers in the official registry | 72, namespace `io.github.nirholas` |
| GPU and service workers | 32 in-repo, running open model families (Hunyuan3D, TRELLIS, TripoSG, TripoSR) plus rig, remesh, texture, segment, stylize, rembg, motion and vision lanes |
| Public pages | 795, of which 128 were added since 1 August 2026 |
| Specs | 31, including the CC0 Spatial MCP and simulation-readiness shapes |
| Test files | around 1,750 |

Every generation lane has a failover chain, so each request always has a next lane ready to answer it. `GET /api/version` returns the exact commit production is running, so you can see that what is deployed is what is on GitHub.

---

## 13. Our partners, and how each one shows up in this stack

Several partner programmes sit underneath what this post describes, and each one connects to a specific part of it. Here they are, with each designation stated exactly:

- **OpenAI**: three.ws is an **OpenAI Select Partner** in the OpenAI Partner Network, an independent member at the Select tier. three.ws is not an OpenAI product and is not endorsed by OpenAI beyond the partner designation. The keyless 3D Studio connector, the custom GPT in the GPT Store, AR handoff, and the Spatial MCP shape are our builds on OpenAI's public Apps SDK and Actions platforms. The free connector is the surface we built for the ChatGPT directory, and the public OAuth 2.1 server that the OpenAI plugin directory requires is already live. Our OpenAI Cookbook example (a self-correcting 3D collectible set built with text-to-3D, function calling, and vision) is open as [PR #2874](https://github.com/openai/openai-cookbook/pull/2874).
- **IBM**: three.ws is an **IBM Business Partner**. Agents can think on IBM Granite models served through watsonx.ai, and Granite Guardian runs as a governance layer in front of autonomous actions, which is the same family of idea as the server-side refusals in section 2. Our public Granite-backed endpoints are independent developer tools built on IBM's publicly available Granite models: not IBM products, not partnership deliverables, and not endorsed by IBM.
- **Amazon Web Services**: three.ws is an **AWS Partner**. The AWS Marketplace SaaS integration is built, deployed, and conformant with the Concurrent Agreements requirements AWS introduced for new SaaS products on 2026-06-01, and the Marketplace listing is coming. It is designed as a free front door: subscribing links an AWS account to a three.ws account and issues an x402 access key for the paid lanes in section 12.
- **Google Cloud**: three.ws is a member of **Google Cloud for Web3 Startups**. Production runs on Google Cloud: one Cloud Run service serves the frontend, the route table, and every API handler, the crons run on Cloud Scheduler, the GPU model workers run on their own Cloud Run services, and Vertex AI provides the Gemini and image lanes in the model chain. Every free tool in this post is served from there.
- **NVIDIA**: three.ws is a member of **NVIDIA Inception** (since July 2026), NVIDIA's programme for startups building on accelerated computing. Membership is a startup programme, not a partnership, an investment, or an endorsement. Every 3D generation lane in section 1 runs on NVIDIA silicon: a self-hosted Cloud Run GPU fleet (L4 plus an RTX PRO 6000 Blackwell) behind text-to-3D, rigging, and motion, plus a free hosted NIM lane behind chat, vision, embeddings, safety, and speech.
- **Alibaba Cloud**: three.ws is **live on the Alibaba Cloud International Marketplace**, with a product listing, a storefront, and an editorial feature on the Alibaba Cloud Marketplace blog. Qwen models are first-class lanes in our multi-model brain router, so an agent can be pointed at a Qwen model the same way as any other.
- **HackerNoon**: our **media partner**. three.ws announcements flow automatically from our RSS feed into HackerNoon's drafts queue, and pieces that publish there carry canonical URLs back to three.ws.
- **Quicknode**: accepted into the **Quicknode Startup Program** (July 2026) with approved infrastructure credits. Quicknode's distributed RPC endpoints are a rung in our Solana RPC failover chain, adding capacity behind agent wallets, x402 settlement verification, and the `rpc` vital in section 8.

We also publish to the Solana dApp Store, where our Android app is live, and an iOS app lives in the repo alongside it. The public map of all of this is at [three.ws/partners](https://three.ws/partners), and partnership enquiries go to partners@three.ws.

---

## 14. What I would like this forum's opinion on

1. **Physical-action tools and MCP annotations.** `destructiveHint` covers "this deletes something". A richer vocabulary could distinguish "this spends $40" from "this unlocks a front door". Is anyone modelling that distinction in a way clients could act on? I would love to converge on something shared.
2. **Consent in stdio MCP servers.** Our answer was to reserve physical actions for surfaces where a person approves them. Is there a pattern where a stdio server can obtain provable human consent directly?
3. **Long jobs in Actions.** Our submit-and-poll shape with `etaSeconds`, a `watchUrl`, a preview image, and an honoured `429 retry_after` works well. Is there appetite for a shared convention so every builder gets it for free?
4. **Binary results.** `look_at_model` was the highest-leverage tool we shipped this year. What other formats would your agent benefit from seeing in its own modality?
5. **Fleet discovery.** If you publish more than a handful of MCP servers, how are you handling namespacing and discovery? The approach above works well for us, and I would love to compare notes.

Happy to answer anything about the internals. The whole stack is Apache-2.0 at [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws), the docs index is at [three.ws/docs](https://three.ws/docs), and the free connector is one `tools/list` away whenever you want to try it.
