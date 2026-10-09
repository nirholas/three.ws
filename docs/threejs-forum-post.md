---
venue: three.js Forum (discourse.threejs.org), category "Resources" (cross-post the demo to "Showcase")
account: nichxbt
description: "Forum post for three.js developers: five open-source pieces pulled out of a production WebGL avatar platform, covering universal humanoid retargeting with no rig allowlist, progressive GLB streaming over plain HTTP, a terminal renderer, structural GLB diffing, and a free physics-readiness grade for glTF."
tags: [three.js, gltf, glb, animation, retargeting, webgl]
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
---

# Five open-source pieces for animating any 3D character, whatever rig it arrives with

_Post for the [three.js forum](https://discourse.threejs.org), category Resources._

Hi everyone! I work on [three.ws](https://three.ws), a browser-native platform built on three.js. You type a sentence, and you get a rigged, animated 3D character you can drop into any web page. It is Apache-2.0, and the source is at [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws).

The fun part of building it has been this: **every character is a surprise.** It might come from our own generation lane, from Mixamo, from VRoid, from Daz, from a Blender export somebody made years ago, or from a user's photo turned into a mesh a minute and a half earlier. Whatever skeleton it brings, it should walk, wave, and talk the moment it loads.

Making that work produced five small, focused tools. We published each one on its own so you can use any of them in your own three.js project without the rest of the platform. Here they are, from the one I use every day to the one I would most love your review on.

## The five, at a glance

| Piece | What it does for you |
|---|---|
| `@three-ws/retarget` | Plays any humanoid clip on any humanoid rig, with no list of supported rigs |
| `@three-ws/avatar-stream` | Shows a correct, skinned avatar early over plain HTTP, then refines it |
| `@three-ws/glb-diff` | Tells you what actually changed between two GLBs |
| Sim-readiness grade | A free check of whether a GLB can be used as a rigid body, with a CC0 spec |
| `@three-ws/tty-3d` | Renders a skinned, animated GLB in a terminal, no GPU needed |

## 1. Retargeting that welcomes every rig

**Package: `@three-ws/retarget`**

Rather than keeping a curated list of supported rigs, we canonicalise bone names first, then retarget onto the canonical set. The mapping understands Mixamo (`mixamorig:LeftArm`), VRM 0.x and VRoid (`J_Bip_L_UpperArm`), VRM 1.0, Daz/Genesis, MakeHuman, the Unreal mannequin, HumanIK/Maya, Blender `.L`/`.R` suffixes, and simple `shoulderL` style names. Adding a new convention is one mapping entry plus a test case, never a new code path.

```bash
npm install @three-ws/retarget three
```

```js
import { AnimationMixer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { canonicalizeGLBBones, retargetClipToObject, parseClipJSON } from '@three-ws/retarget';

const raw = await fetch('https://three.ws/avatars/xbot.glb').then((r) => r.arrayBuffer());
const { buffer } = canonicalizeGLBBones(raw);

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.parseAsync(buffer, '');

const clipJSON = await fetch('https://three.ws/animations/clips/walk.json').then((r) => r.json());
const result = retargetClipToObject(parseClipJSON(clipJSON, 'walk'), gltf.scene);

if (result.clip) new AnimationMixer(gltf.scene).clipAction(result.clip).play();
```

The clip URLs are real: three.ws serves its shared clip library with open CORS, so that snippet runs as-is.

Three details we invested the most in:

**Legs get first-class treatment.** Arm chains are forgiving about proportions. Hip and foot chains need care, so the retargeter corrects rest-pose skew (A-pose versus T-pose) and hip up-axis differences automatically, and scales hip motion to the target's proportions. The result is a walk with planted feet on rigs of very different heights.

**A clear coverage gate.** Every result carries `coverage`, `matched`, `total`, and `dropped`. Below 50% bone coverage the clip comes back as `null` with the full breakdown, which is a clean, honest signal that the model is not a humanoid.

**The fallback is always a living character.** When a model cannot be skeleton-driven (no skin, or a non-humanoid prop), the runtime detects it through `supportsCanonicalClips()` and falls back to a default rig, so every visitor sees a character in motion.

If you would rather not manage mixers yourself, `AnimationManager` loads a clip library from a manifest, retargets per rig, crossfades between states, and layers one-shot overlays (a wave, a jump) over a base loop (idle, walk). If you have ever hand-mapped a skeleton table, this is the package I would have wanted.

## 2. Progressive GLB over plain HTTP

**Package: `@three-ws/avatar-stream`, spec `A3S` (CC0), live at three.ws/stream**

A GLB is atomic: a client needs every byte before it can draw a triangle, because an index near the end can reference a vertex near the start. `avatar-stream` reorders the asset so that **any byte prefix of the file is a complete, valid asset**, and the viewer can draw as soon as the first layer lands, then refine.

The trick is a lovely property of successive edge-collapse simplification: the vertices that survive at each coarser level are a strict subset of the level below. The levels nest. Rank every vertex by the coarsest level it survives into, sort the vertex buffer by that rank, and each refinement layer only appends vertices the client does not have yet. It never rewrites bytes already sent.

Skinning comes along for free. A simplifier emits a new index buffer over the vertex array it was given, so `JOINTS_0` and `WEIGHTS_0` are carried along untouched, and the very first coarse layer is already bound to the full skeleton. That means the first thing a visitor sees is the right character with the right proportions, already animating, rather than a placeholder.

It works over ordinary HTTP from a static host, and it composes with compression rather than replacing it. The endpoint is `GET /api/avatar-stream?src=<glb>`, the reference implementation is the package, and the container format is published as a CC0 spec so anyone can implement it.

## 3. A structural diff for glTF

**Package: `@three-ws/glb-diff`, live at three.ws/diff**

When a pipeline iterates on a mesh, "did that change anything?" comes up constantly. `glb-diff` answers it structurally: node graph, meshes, primitives, materials, textures, skins, and animations, with git-style rename and move detection.

```bash
npx @three-ws/glb-diff before.glb after.glb --markdown
npx @three-ws/glb-diff base.glb candidate.glb --fail-on major
```

`--markdown` produces a report sized for a pull-request comment, `--json` gives the full change set, and `--fail-on <level>` exits non-zero once a change reaches the severity you choose, so it drops straight into a CI job that guards your asset folder.

It started as a debugging tool for our refine loop and quickly became the thing I reach for most whenever a model needs a closer look. If you run any pipeline that mutates glTF (optimisation, retexturing, decimation), it is worth ten minutes.

## 4. A physics-readiness grade, and a CC0 spec for it

**Free endpoint: `GET https://three.ws/api/sim-readiness?src=<glb>`. Free MCP tool: `grade_sim_readiness`. Spec: `specs/SIM_READINESS.md`, CC0**

This is the one I would most love this forum's review on.

A physics engine asks a stricter question than a renderer. It needs a closed surface, consistent winding, positive volume, and dimensions in real-world metres. A GLB has no field that says whether it meets those, so the grade answers all four mechanically:

```bash
curl "https://three.ws/api/sim-readiness?src=https://three.ws/avatars/cesium-man.glb"
```

Cesium Man comes back `simulation_ready`: 4,672 triangles, 1.51 m tall, about 0.054 cubic metres of volume, with the centroid and an inertia tensor at unit density in the same response.

Four verdicts. `simulation_ready` is the one that licenses trusting the reported mass. `needs_scale` means the geometry is sound and only the units need setting (multiply and go). `needs_repair` means the surface is open, non-manifold, or inconsistently wound, so the mass properties are reported as provisional. `unusable` means there is nothing to simulate (no triangles or zero volume). A fifth value, `unreadable`, is for bytes that are not binary glTF 2.0 at all, kept deliberately distinct from a valid file with nothing to simulate.

Results are content-addressed by the file's SHA-256, so the same bytes always get the same verdict and caching is trivially correct. When a model is credentialed, its grade can also ride inside a signed content credential, together with the grader version that produced it, so a grade is a durable, attributable claim.

It is free and keyless on purpose: a free check is a check that runs on every asset, which is exactly where it does the most good.

## 5. A terminal renderer, which is more useful than it sounds

**Packages: `@three-ws/tty-3d` (core), `@three-ws/tty-avatar` (the CLI)**

```bash
npx @three-ws/tty-avatar 81a076b6-55ff-49a2-b007-1d88e7dce2aa
```

That draws a skinned, animated GLB in colour at 24fps in a plain terminal. It is a software rasterizer: it decodes the glTF, evaluates the animation, blends joint matrices per vertex on the CPU, and rasterizes into a z-buffered framebuffer sized to your terminal. No GPU, no browser, no display server, so it runs identically over SSH, in CI, and inside a container. With nothing installed at all, `curl three.ws/tty` works too.

Three glyph modes: truecolor half-blocks (two colours per cell), braille (2x4 dots per cell for four times the vertical detail), and a plain luminance ramp when the output is piped.

Two reasons we love it. First, building a second renderer made the animation stack fully renderer-agnostic, which strengthened it for WebGL as well. Second, wire it to a coding agent's hooks and the avatar becomes that agent's face: thinking while it reads, nodding while it edits, shaking its head when a tool reports an error, bouncing when it finishes. An ambient posture in a second pane is a friendly progress indicator you can read without switching focus.

## Production practices we rely on

**Decode meshopt once, at the front of the pipeline.** Most of our avatars ship with `EXT_meshopt_compression`, and every browser viewer handles it beautifully. For server-side consumers (our Python workers use trimesh), we decode once at the entrance with a pinned `gltfpack`, so every downstream step reads plain geometry.

**Dispose the context between scenes.** Releasing GPU resources on unmount keeps scene-to-scene navigation smooth, even on a laptop loading its third scene in a row.

**Wake heavy previews on view.** A grid of 3D previews initialised through an intersection observer only spends GPU on what is on screen. It turned our marketplace grid into a smooth scroll.

**Keep the light rig in one shared module.** Ours is `@three-ws/viewer-presets` (tuned light rigs, floor reflections, bloom, and PBR presets), so every studio page inherits the same soft shadows and the same look from one place. A render-and-compare test on that module is the strongest way to keep it consistent.

**52 ARKit blendshapes is the interchange currency for faces.** It is what the tooling, the capture stacks, and the models converge on. We map onto it and keep each rig's conventions in one adapter, which is also how a VRM or Oculus-viseme rig lip-syncs from an ARKit-52 track.

## Who we build with

three.ws takes part in eight partner programmes, and a few of them show up directly in the pieces above:

- **OpenAI Select Partner.** Our free 3D Studio connector puts text-to-3D, rigging, refinement, and `look_at_model` inside ChatGPT, with the models rendered interactively inline. We also publish Spatial MCP, an open CC0 response shape that makes a 3D scene a native MCP result rather than a link, with three.ws as the reference implementation.
- **NVIDIA Inception.** three.ws is an NVIDIA Inception member, and every character these tools animate is generated on NVIDIA GPUs: a self-hosted fleet of L4s plus an RTX PRO 6000 Blackwell.
- **Google Cloud.** three.ws is a member of Google Cloud for Web3 Startups. The whole platform, including `sim-readiness`, `avatar-stream`, and the diff page, is served from Cloud Run.
- **HackerNoon (Media).** Our engineering write-ups syndicate to HackerNoon's developer audience with canonical links back to three.ws.
- **Alibaba Cloud, IBM, AWS, and Quicknode** complete the eight, across cloud, models, and infrastructure.

These are programme designations, and the views here are our own. The full map is at [three.ws/partners](https://three.ws/partners).

## What is where

- Retargeting: `@three-ws/retarget`
- Progressive streaming: `@three-ws/avatar-stream`, spec `specs/AVATAR_STREAM.md` (CC0), demo at three.ws/stream
- Diffing: `@three-ws/glb-diff`, and the page at [three.ws/diff](https://three.ws/diff)
- Physics readiness: [three.ws/docs/sim-readiness](https://three.ws/docs/sim-readiness), spec CC0
- Terminal rendering: `@three-ws/tty-3d`, `@three-ws/tty-avatar`
- Viewer look and feel: `@three-ws/viewer-presets`
- The whole platform, if you want to see them in situ: [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws)

The generation side runs open model families on our own GPU fleet, and the free lane is keyless if you want to make something to test any of this against: [three.ws/forge](https://three.ws/forge).

Questions welcome, especially on 1 and 4. The retarget mapping would love more rig conventions from anyone who has met ones we have not mapped yet, and the readiness spec would benefit from review by anyone who has shipped assets into a physics engine.
