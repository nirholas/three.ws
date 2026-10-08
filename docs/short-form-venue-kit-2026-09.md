---
title: "Short-form venue kit, September 2026"
description: "Paste-ready copy for the venues that take a paragraph rather than an article: Show HN, Product Hunt, five subreddits, LinkedIn, the Alibaba Cloud developer community, and a Khronos glTF discussion opener. Each entry carries the venue's own rules, the copy, and the first comment."
status: drafts, owner approval required before posting (external-channel gate in CLAUDE.md)
---

# Short-form venue kit, September 2026

The long-form drafts live one per file (see [publishing-program-2026-09.md](./publishing-program-2026-09.md) for the full matrix). This file holds the venues where the unit of publication is a paragraph, a title, or a first comment.

**Rules that apply to every entry here.** Post as a participant, not as a brand voice: each of these communities rewards a specific technical claim with a link that backs it. Keep every line positive and confident: describe what the work does and the design principle behind it. Never post the same text to two subreddits. Answer replies yourself, in your own words. If a claim is not checkable in a live endpoint or the repository, cut it. Where a venue welcomes it, mention the partner programmes using the exact designations in [partners.md](./partners.md), never as an endorsement.

---

## 1. Show HN

**Venue:** news.ycombinator.com, "Show HN". One submission, then you live in the comments for six hours.
**Rules that matter:** the title must describe the thing, not sell it; no superlatives; the URL should be the thing itself, not a blog post about it.

**Title (78 characters)**

```
Show HN: Free physics-readiness grade for any glTF file, and a CC0 spec for it
```

**URL**

```
https://three.ws/docs/sim-readiness
```

**First comment (post immediately after submitting)**

> A physics engine asks a stricter question than a renderer: is the surface closed, is the winding consistent, is the volume positive, and are the dimensions real-world metres? A glTF file has no field for that, so robotics, game-physics and world-model pipelines each answer it with their own checks.
>
> This is a shared, mechanical answer to the question a physics engine actually asks: can I use this as a rigid body right now, and if not, exactly what does it need. Four verdicts. `simulation_ready` is the only one that licenses trusting the reported mass. `needs_scale` means the geometry is sound and only the units are missing. `needs_repair` means the surface is open, non-manifold, or inconsistently wound, so mass properties are reported as provisional. `unusable` means there is nothing to simulate (no triangles or zero volume). A fifth value, `unreadable`, is for bytes that are not glTF at all, deliberately distinct from a valid file with nothing to simulate.
>
> Free and keyless, so it can run on every asset:
>
>     curl "https://three.ws/api/sim-readiness?src=https://three.ws/avatars/cesium-man.glb"
>
> That one comes back `simulation_ready`: 4,672 triangles, 1.51 m tall, about 0.054 cubic metres, with the centroid and a unit-density inertia tensor in the same response. Results are content-addressed by SHA-256, so identical bytes always get an identical verdict, and there is a free MCP tool (`grade_sim_readiness`) for agents that want to grade before they spend.
>
> The spec is CC0 and the grader is a pure function you can vendor. The outcome I am hoping for is other people implementing it. Source is Apache-2.0 at github.com/nirholas/three.ws. Context: I build a text-to-3D platform, we built this for our own pipeline, and we published it so nobody has to write it twice.
>
> Two design choices I would love sharp eyes on: the boundary between `needs_repair` and `unusable`, and whether "real-world extents" works best as part of the verdict or as a warning alongside it.

**Alternate submission, if the readiness one has already run:** `Show HN: A live 3D avatar in your terminal, as your coding agent's face` pointing at the `@three-ws/tty-avatar` README.

---

## 2. Product Hunt

**Venue:** producthunt.com. Ship Tuesday to Thursday, 00:01 PT.
**Rules that matter:** tagline maximum 60 characters, description around 260, first comment is where the launch is actually won.

**Name**

```
Materialize by three.ws
```

**Tagline (58 characters)**

```
Describe an object, get it printed and posted to your door
```

**Description (259 characters)**

```
Type a description, three.ws generates the 3D model, and Materialize prints it in resin, nylon, colour sandstone or steel and ships it. Free printability report before any price. Every step is also an API, so an AI agent can order a physical object by itself.
```

**Topics:** 3D, Artificial Intelligence, Design Tools, Developer Tools, Hardware

**Maker's first comment**

> Hi Product Hunt. I build three.ws, an open-source platform that turns a sentence into a rigged 3D character. Materialize is the part that leaves the screen.
>
> The loop: describe something, we generate it, and then it gets manufactured and posted to you. What I care about most is the order the steps happen in.
>
> **The analysis is free and comes first.** Before any price, you get a printability report: whether the mesh is a closed solid, how many separate bodies it has, where the holes are, the thinnest wall, the exact volume, and a 0 to 100 score with named deductions written for a person rather than a slicer. Free, so every model gets checked before anyone spends a cent.
>
> **The quote is signed and lasts 24 hours,** so the price you were shown is the price you pay.
>
> **Every print ships with proof it is the one you ordered:** a certificate of authenticity with a QR code in the box, and creators can cap how many copies of a model will ever exist.
>
> **Every order is screened before production.** Weapons, functional key duplicates, and third-party brand marks are filtered out in code. A print bureau puts a person at that checkpoint; our buyer might be an AI agent, so the checkpoint lives in the API itself.
>
> That is the part I am most excited about: an AI agent can run the whole loop, quote and order included, end to end, so an agent can turn an idea into a physical object it pays for itself.
>
> The 3D models come from open model families running on our own NVIDIA GPU fleet. three.ws is an NVIDIA Inception member and an OpenAI Select Partner, and our free 3D Studio connector brings the same generation tools into ChatGPT.
>
> Free to try the generation half with no account: three.ws/forge. Everything is Apache-2.0. Happy to answer anything, including pricing per material and how the printability score is calculated.

---

## 3. Reddit

Five subreddits, five different posts. Never cross-post the same body.

### r/homeassistant

**Title:** `Built a HACS integration that dials out over one WebSocket, so a LAN-only HA can drive a 3D assistant. The lock handling is the interesting part.`

**Body:**

> Most HA installs live on a home network with no forwarded port and no public address, so I designed for exactly that. This integration works the other way around: the house dials out over a single outgoing WebSocket and the service never dials the house. Nothing listens on your network, no port forwarding, no tunnel daemon, and the service never receives an HA token (the integration mints its own credential locally and it never leaves the house).
>
> What it connects to is a 3D agent that stands in a live model of your home and talks to you, plus an MCP server so Claude, Cursor or your own assistant can read and drive the house.
>
> The part I am proudest of is locks. Every call that would open the house passes through one physical-action gate that resolves the real entities and service each call performs, and over stdio, door-opening stays on surfaces where a person can see and approve it (owners can grant one specific door to their own assistant explicitly). Household roles are enforced server-side too: five roles from owner to wall display, guests can turn on lights while approving an unlock stays with residents, and a scoped guest's other rooms are removed from the payload rather than hidden in the UI. Spoken confirmation accepts one deliberate word, "confirm", so conversation elsewhere in the room cannot stand in for it.
>
> Also: we prototyped the agent as a Matter device with matter.js (it commissioned into a real HA in 744 ms) and published the full write-up with measurements.
>
> Repo: github.com/nirholas/three-ws-home-assistant (HACS custom repository). Docs and the relay threat model: three.ws/docs/smart-home. Apache-2.0.
>
> I would love this sub's take on the stdio design: approval where a person can see it, plus explicit per-door allowances for owners who want them. How would you shape it for your house?

### r/threejs

**Title:** `Five open-source pieces for animating any 3D character, whatever rig it arrives with (retargeting with no rig allowlist, progressive GLB, glTF diffing, a physics grade, a terminal renderer)`

**Body:** short pointer to the [three.js forum post](./threejs-forum-post.md), with the retargeting section quoted in full and an invitation to share rig conventions we can add to the mapping.

### r/LocalLLaMA

**Title:** `We let our text-to-3D agent look at what it made: rendering each result back into the model's own modality turns one-shot generation into a generate, judge, refine loop.`

**Body:**

> This is the smallest change we made this year and the one that unlocked the most.
>
> A `.glb` is a compact binary of vertices, materials, and bones, and a language model reads text and images. So we show the model its own output as images: render the result from several angles (up to six views, 128 to 1024 px) and return the frames as MCP image content blocks. A multimodal model looks at what it made, judges it, refines it, and looks again. Alongside the frames we return geometry facts and a plain-language reading of them.
>
> Pair it with `refine_model` (describe a change in words, get a new version with a branchable lineage) and the whole generate, look, judge, refine cycle runs inside any MCP client. The 3D side is open models (TRELLIS, Hunyuan3D, TripoSG) on our own NVIDIA L4 fleet.
>
> The generalisation is not about 3D at all: **any tool that hands an agent a binary benefits from a companion that renders it into the agent's own modality.** PDFs, spreadsheets, audio, CAD, compiled artifacts. Give your agent a way to perceive its own output and it starts iterating.
>
> Free and keyless if you want to try it against your own stack: `POST https://three.ws/api/3d/look`, the npm package `@three-ws/see`, or the tool `look_at_model` on `https://three.ws/api/mcp-studio`. Everything Apache-2.0.

### r/3Dprinting

**Title:** `We built a free printability report API (closed solid, separate bodies, thinnest wall, exact volume, 0-100 score with named deductions) and made it the step before any price is quoted`

**Body:** the analysis-first design, the four things it measures, a clear note that the printing lane behind it is a paid service, and an invitation to suggest how the deductions could be sharper. Lead with the free endpoint; the sub values useful tools.

### r/robotics

**Title:** `A free physics-readiness grade for generated meshes (closed surface, consistent winding, positive volume, real-world scale), plus a CC0 spec you can vendor`

**Body:** the four verdicts, the `needs_scale` versus `needs_repair` distinction, the content-addressed caching, the free `grade_sim_readiness` MCP tool, and an open invitation for review from people who ship assets into MuJoCo or Isaac.

---

## 4. LinkedIn article

**Venue:** LinkedIn article from the founder account, not a company post.
**Audience:** partners, enterprise readers, and people evaluating the company.

**Title**

```
The quarter our AI agents left the browser tab
```

**Opening (first 210 characters are the preview, make them count)**

> For most of this year our agents lived in a browser tab, where every decision ended in a sentence. This quarter they got a house, a car, and a factory, and the engineering grew to match.

**Structure:** why real-world reach raises the engineering bar; the three capabilities (home, car, manufacturing); the governance layer that makes them trustworthy (household roles, spoken confirmation, screened print orders); the operating principle that a guard lives on the server, in code; the partner programmes, each stated with its exact designation from [partners.md](./partners.md) (OpenAI Select Partner, IBM Business Partner, NVIDIA Inception member, member of Google Cloud for Web3 Startups, live on the Alibaba Cloud International Marketplace, AWS Partner, HackerNoon media partner, Quicknode Startup Program) and tied to what each one powers; and a close on what it takes to build an agent economy that runs in production. Keep it to 900 words, no code blocks, one link at the end (three.ws/partners works well).

---

## 5. Alibaba Cloud developer community

**Venue:** the Alibaba Cloud developer community, following our live Alibaba Cloud International Marketplace listing and storefront, and the editorial feature Alibaba Cloud Marketplace published on its blog.
**Angle:** the model router. Qwen models are first-class lanes in a multi-provider brain router (`/api/brain/chat`) that any agent can be pointed at, reached through DashScope alongside the other providers, and there is a published, community-built MCP server (`@three-ws/alibaba-cloud-mcp`, registry name `io.github.nirholas/alibaba-cloud`) exposing Qwen chat, embeddings, and model discovery on your own DashScope account to any MCP client.

**Working title**

```
Adding Qwen as a first-class lane in a multi-provider agent brain, and what a router owes each provider
```

**The one non-obvious point to build the piece around:** a great router respects each provider's conventions. Reasoning families, tool-call shapes, and streaming conventions differ, so the router normalises the parts that must be uniform (for Qwen3 that includes turning reasoning mode off when a caller wants the answer in `content`) and reports the model that actually answered, so every caller knows exactly which lane served it.

---

## 6. Khronos glTF discussion opener

**Venue:** the glTF project's public discussion tracker on GitHub (a discussion, not an issue, and not a pull request).
**Purpose:** find out whether a machine-readable physical-usability claim belongs anywhere near the ecosystem, before proposing anything formal.

**Title**

```
Discussion: is there appetite for a machine-readable "can this be simulated" claim for glTF assets?
```

**Body**

> Context, briefly: we run a text-to-3D service, and our output flows into physics engines, game engines, and robotics stacks. Each of them asks whether an asset can be used as a rigid body, and today each pipeline answers that with its own checks. A shared, machine-readable claim could let them all answer it the same way.
>
> We wrote and published one (CC0 spec, free endpoint, pure-function grader) covering four verdicts: closed surface with consistent winding and positive volume and plausible real-world extents, versus geometry that is sound but unit-scaled, versus an open or non-manifold surface whose mass properties are provisional, versus nothing to simulate at all.
>
> Before proposing anything formal, I would love to understand how the community sees the shape of it:
>
> 1. Is this a file-level claim, a validator concern, or purely an application concern?
> 2. If it belongs anywhere in the ecosystem, is it an extension, a validator rule set, or a convention?
> 3. Is "plausible real-world extents" defensible as part of a verdict, or should unit ambiguity only ever be a warning?
>
> Every answer is useful here, including "this is an application concern, keep it out of the format". Thank you in advance for any perspective.
