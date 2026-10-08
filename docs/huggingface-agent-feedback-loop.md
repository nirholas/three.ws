---
venue: Hugging Face community article (huggingface.co/blog/three-ws/...)
account: three-ws (organization)
suggested_title: "Generate, look, grade, iterate: closing the feedback loop for agentic 3D"
description: "Third three.ws article for the Hugging Face community. This is the loop we built so an agent can judge and improve its own 3D output: rendering results back into the model's own modality, a mechanical physics-readiness grade, structural diffing between iterations, versioned refinement, and universal retargeting, all on open models running on our own GPUs."
tags: [3d, agents, mcp, open-models, evaluation]
house_rules: |
  Hugging Face blog rules as applied to our previous two articles: keep it AI-focused.
  No coin, exchange, listing, or token content anywhere in this piece. Partner status
  may be stated factually where it is technically relevant, never as promotion.
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
---

# Generate, look, grade, iterate: closing the feedback loop for agentic 3D

Hello again, Hugging Face community! This is the third piece we have published here. The [first](https://huggingface.co/blog/three-ws/giving-ai-agents-bodies-and-wallets) argued that agents deserve bodies. The [second](https://huggingface.co/blog/three-ws/building-3d-ai-agents-end-to-end) walked the whole stack end to end. This one is about a single building block that we think every agentic 3D pipeline can benefit from, and what it unlocked for ours.

**The idea in one sentence: render every 3D result back into a modality the model can perceive, and the agent can judge its own work.**

Here is why that matters, in plain terms. When an agent asks a text-to-3D model for "a ceramic robot", the answer is a `.glb` file: a compact binary of vertices, materials, and bones. People open it in a viewer. A language model reads text and images, so the natural next step is to show it the model as images. Once the agent can see what it made, it can say "the far side is unfinished, try again", and a single generation becomes a loop: generate, look, judge, refine, look again.

Everything below is Apache-2.0 at [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws), and every endpoint marked free is keyless.

## The loop at a glance

| Step | Question it answers | Tool |
|---|---|---|
| Generate | Make me a model | `forge_free`, `forge_avatar`, `text_to_avatar` |
| Look | What does it look like? | `look_at_model`, `@three-ws/see`, `POST /api/3d/look` |
| Grade | Can a physics engine use it? | `grade_sim_readiness`, `GET /api/sim-readiness` |
| Refine | Change it, and keep the history | `refine_model` with version lineage |
| Diff | Did that change actually do anything? | `@three-ws/glb-diff` |
| Animate | Make it move, whatever its rig | `@three-ws/retarget` |

## 1. Let the model look at what it made

The step that changes everything is beautifully simple: render the result into a modality the model perceives.

Our `look_at_model` tool renders a GLB from several angles and returns the frames as **MCP image content blocks**, so a multimodal client renders them straight into the conversation. Alongside the frames it returns the geometry facts (triangle count, bounds, material count, whether it is skinned) and a plain-language reading of them, such as "12,400 triangles, a normal real-time budget for a hero prop or character". You can ask for up to six views (front, three-quarter, side, back, top, bottom) at sizes from 128 to 1024 pixels; the default is three-quarter, front, side, and back.

Three ways in, because different consumers want different shapes:

| You are | Use | You get |
|---|---|---|
| An MCP client | `look_at_model` on `https://three.ws/api/mcp-studio` | frames as image blocks, rendered inline |
| A Node program | `@three-ws/see` | `see(url)` returns views, stats, notes, a viewer link, and an AR link |
| Anything with HTTP | `POST https://three.ws/api/3d/look` | JSON with a frame URL per angle |

```bash
curl -s -X POST https://three.ws/api/3d/look \
  -H 'content-type: application/json' \
  -d '{"glb_url":"https://three.ws/avatars/cesium-man.glb"}'
```

In Node, `toMessageContent(look)` shapes a look into multimodal chat content (one labelled text block per angle, followed by the image), so the frames go straight into any vision-capable model's message. Pass `{ fetchImages: true }` to inline base64 for APIs that prefer bytes to URLs.

What this changes is the agent's role: it can now **judge** a generation, which means it can decide to refine, and every refinement is its own version with its own artifacts.

The broader lesson is not about 3D at all: **any tool that hands an agent a binary benefits from a companion that renders it into the agent's own modality.** Ours was a mesh. Yours might be a PDF, a spreadsheet, an audio file, a CAD assembly, or a compiled artifact. Give your agent a way to perceive its own output and it moves from guessing to iterating.

## 2. A grade, so "good" means something mechanical

Perception gives an agent taste. A grade gives it a specification.

A physics engine asks a stricter question than a renderer: is the surface closed, is the winding consistent, is the volume positive, and are the dimensions real-world metres? A GLB has no field that says, so robotics, game-physics, and world-model pipelines each answer that question with their own checks. We published one mechanical answer, free, and CC0:

```bash
curl "https://three.ws/api/sim-readiness?src=https://three.ws/avatars/cesium-man.glb"
```

Cesium Man grades `simulation_ready`: 4,672 triangles, 1.51 m tall, about 0.054 cubic metres of volume, returned with its centroid and an inertia tensor at unit density.

Four verdicts:

| Verdict | Meaning |
|---|---|
| `simulation_ready` | Closed surface, consistent winding, positive volume, real-world extents. The verdict that licenses trusting the reported mass. |
| `needs_scale` | Geometry is sound, and only the units need setting. Multiply; mass properties scale with it. |
| `needs_repair` | Open, non-manifold, or inconsistently wound. Mass is reported as provisional. |
| `unusable` | Nothing to simulate: no triangles, or zero volume. |

A fifth value, `unreadable`, covers bytes that are not binary glTF 2.0 at all, kept deliberately distinct: one is a file that could not be read, the other is a valid file with nothing to simulate. Verdicts are content-addressed by the file's SHA-256, so identical bytes always get an identical grade and caching is trivially correct.

Three design decisions we would happily defend to anyone building evaluation infrastructure:

**Free, permanently.** It is also a free, read-only, idempotent tool on our *paid* MCP server, a deliberate exception to that server's pricing. A free check runs on every asset, and that is where it does the most good. The practical pattern is order of operations: an agent shopping for a prop can grade ten candidates for nothing and spend only on the one a solver can use.

**A spec, not a service.** [`specs/SIM_READINESS.md`](https://github.com/nirholas/three.ws/blob/main/specs/SIM_READINESS.md) is CC0, and the grader is a pure function you can vendor. If other people implement it and we never see the traffic, that is the outcome we are hoping for. A shared, machine-readable claim about physical usability is a great fit for the glTF ecosystem.

**Signed and versioned.** When a model is credentialed, a compact subset of its grade (the verdict, blockers, volume, longest axis, inertia, and convexity ratio) rides inside its signed content credential together with the grader version, `threews.sim.readiness.v1`. A signed grade is a durable claim about what that grader version measured, and a newer grader reports alongside it rather than overwriting it.

## 3. Refine, with a history you can branch

`refine_model` takes a model and a change described in words ("make it metallic", "bigger helmet", "add wings") and runs a real anchored regeneration: the prior prompt is carried forward and folded together with the change, and an optional reference image of the current model anchors it as image to 3D.

Every refinement is appended to an immutable **version lineage** returned with the result. The client passes that array back on the next call to extend the thread, or targets an earlier version with `parent_index` to **branch**. Reverting is a pointer move over the array, and the inline viewer shows the lineage as a version strip you can click to cross-fade between versions. For an agent, that means exploring two directions from the same parent is as easy as exploring one.

## 4. Diff, so "changed" means something structural

Between iterations, "did that actually change anything?" comes up constantly, and a structural answer scales far better than comparing two viewers by eye.

`@three-ws/glb-diff` compares node graph, meshes, primitives, materials, textures, skins, and animations, with git-style rename and move detection. Its CLI emits JSON or a Markdown report sized for a pull-request comment, and `--fail-on <level>` turns it into a CI gate. It began as a debugging tool for the refine loop, and it is now what we reach for whenever a model deserves a closer look. If your pipeline mutates glTF anywhere (optimisation, retexturing, decimation, rigging), it is well worth wiring in.

Together they make a refine loop you can evaluate: perception says whether it looks right, the grade says whether it is usable, the lineage says where it came from, and the diff says what the last change did.

## 5. Retargeting, because every rig is welcome

The other half of agentic 3D is that the asset should *do* something, and animation is where a universal approach pays off most.

We never see a model before it arrives. It might come from our own lanes, from Mixamo, VRoid, Daz, Unreal, or a Blender export from years ago. So instead of a curated allowlist of supported rigs, we canonicalise bone names, then retarget onto the canonical set. The mapping covers Mixamo, Avaturn, VRM 0.x and VRoid, VRM 1.0, Daz/Genesis, MakeHuman, the Unreal mannequin, HumanIK/Maya, Blender `.L`/`.R`, and simple `shoulderL` conventions. A new convention is one mapping entry plus a test. Rest-pose skew and hip up-axis differences are corrected automatically, every result reports its bone coverage, and a model that cannot be skeleton-driven falls back to a default rig, so every user sees a character in motion.

It is published on its own as `@three-ws/retarget`, with a crossfading runtime that layers one-shot gestures over a base loop.

## 6. The models underneath, and the fleet that serves them

All of this rests on generation, and ours is open models on hardware we run:

- **TRELLIS** for native single-hop image to 3D, taking both user photos and the view our text lane synthesizes.
- **Hunyuan3D** for high-poly image-conditioned reconstruction, poly-budget aware.
- **TripoSG** for sketch to 3D, and **TripoSR** in the family around it.
- Plus the pipeline workers: rigging, remeshing, texturing, segmentation, stylization, background removal, avatar reconstruction from a photo, text to motion, video to motion, video to scene, and sign-language synthesis.

More than thirty workers, most published as Docker images. They run as individual GPU services (NVIDIA L4s, plus one RTX PRO 6000 Blackwell for the heaviest lane), each speaking the same task shape, each with a failover chain so a busy model hands the request to the next lane and the request still completes. Each lane also carries an explicit cold-start budget (45 seconds for TripoSG, 60 for TRELLIS, 75 for Hunyuan3D), which feeds the time estimate a user sees.

Three production principles we rely on:

**Decode meshopt once, at the front.** Most of our avatars ship with `EXT_meshopt_compression`, which every browser viewer handles well. Our Python workers read geometry with trimesh, so every worker that loads a caller's mesh decodes it at the entrance with a pinned `gltfpack`, and everything downstream reads plain geometry.

**Audit pinned model ids on a schedule.** A job runs every six hours, checks every hardcoded model id against the live provider catalogues, and confirms with a live one-token call before flagging anything, so the team hears about a catalogue change well before any user does.

**Give every failover chain a keyless foundation.** Two rungs in our text chain need no key at all, so the chain always has somewhere to land whatever keys are configured.

## 7. Partners who make the loop possible

three.ws takes part in eight partner programmes. The ones technically relevant to this loop:

- **NVIDIA Inception.** three.ws is a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing. Every 3D generation lane above runs on NVIDIA GPUs, and NVIDIA-hosted models serve our chat, vision, embeddings, and speech lanes.
- **OpenAI Select Partner.** three.ws is an OpenAI Select Partner. The keyless 3D Studio connector brings this whole loop into ChatGPT, including `look_at_model` and `refine_model`, with models rendered interactively inline. Our open, CC0 Spatial MCP response shape makes a 3D scene a native MCP result, with three.ws as the reference implementation.
- **IBM Business Partner.** Agents can think on IBM Granite models through IBM watsonx.ai with their own IBM Cloud credentials, and our Granite-backed surfaces (vision, the Guardian trust layer, time-series forecasting) are independent developer tools built on IBM's publicly available Granite models.
- **Google Cloud.** three.ws is a member of Google Cloud for Web3 Startups. Production and the GPU fleet run on Cloud Run, and Vertex AI provides the Gemini and image lanes.
- **Alibaba Cloud.** Qwen models are first-class lanes in our multi-provider model router, so an agent can be pointed at a Qwen model as easily as any other.

These are programme designations, stated here for technical context. None of these companies has reviewed this article.

## 8. What we would love the community to take, build on, or fork

- **`look_at_model` is the pattern, not the product.** Render your agent's output into your agent's modality. It is a weekend of work, and it changes what your pipeline can do.
- **The readiness spec is CC0, and we would love implementations.** If you ship assets into a simulator, we would love your view on the four verdicts.
- **Retargeting without an allowlist works today**, and the mapping table welcomes conventions we have not met yet.
- **Publish your reasoning.** We publish the reasoning behind each design decision, including directions we explored and documented, and every time we have, somebody has arrived with a sharper idea.

Free to try, no account and no key: [three.ws/forge](https://three.ws/forge) for generation, `https://three.ws/api/mcp-studio` for the fourteen-tool MCP server (the 3D tools, the asset catalog, and the persona tools), and the [three-ws organization](https://huggingface.co/three-ws) here for the avatar model repo and the viewer Space.
