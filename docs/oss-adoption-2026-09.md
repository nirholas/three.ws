# Open-source adoption plan, September 2026

A survey of open-source repos, npm packages, and model weights that three.ws
does **not** already use, ranked by what they would actually change here, with
the exact file each one lands in.

This is the decision document. Its sibling
[popular-3d-github-repos.md](popular-3d-github-repos.md) is a popularity
snapshot of the whole 3D ecosystem; that one answers "what exists", this one
answers "what should we adopt, and where does it go".

## How this list was built

Three passes, run on 2026-09-07:

1. **Gap detection.** A presence sweep of ~120 candidate project names across
   `src/`, `api/`, `workers/`, `packages/`, `services/`, and `scripts/`. Anything
   already wired (Kokoro TTS, `@pixiv/three-vrm`, Make-It-Animatable, TRELLIS,
   Hunyuan3D 2.0/2.1, TripoSG, MDM, QuadriFlow, xatlas, meshoptimizer, Colyseus,
   Yjs, Rapier, gltf-transform) was dropped from the list. This document only
   contains things the repo genuinely lacks.
2. **Verification.** Every license, star count, and last-push date below came
   from the GitHub REST API or the npm registry directly, not from a blog. The
   "best of 2026" listicles were checked and discarded: several assert a
   "TRELLIS.2" release that does not exist in `microsoft/TRELLIS`.
3. **Measurement, where a claim was cheap to test.** The BiRefNet latency
   numbers below were measured locally rather than quoted.

Star counts are as of the sweep date and drift.

---

## Shipped in this pass

### BiRefNet as an optional background-removal model

**[ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet)** (MIT, 4.2k
stars, last push 2026-09-02).

The [rembg worker](../workers/rembg/) ran four DIS/U2Net-family models. Those
smear a soft boundary (hair, fur, foliage, a thin strap) into a halo, and since
every image-to-3D lane reconstructs geometry from the matted subject, that halo
becomes real polygons on the finished mesh.

The pinned `rembg==2.0.59` already ships BiRefNet sessions; the worker's model
allowlist simply did not include them. `birefnet-general-lite` is now a
selectable model (short alias `birefnet`) across the worker, `api/forge-rembg.js`,
the x402 pipeline, the service catalog, and the MCP studio tool.

Measured on 4 threads with the repo's pinned `onnxruntime==1.28.0`, best of three
warm runs at 677x1024:

| Model | Weights | Latency |
|---|---|---|
| `isnet-general-use` (default) | 170 MB | 1.0 s |
| `birefnet-general-lite` | 214 MB | 6.0 s |

Six times the compute is worth it on a hero image and not worth it on a batch,
so the default is unchanged and the policy tests pin it that way. Details and
the model-choice table: [workers/rembg/README.md](../workers/rembg/README.md).

Note the license trap this avoids: **RMBG-2.0** is the model most "best
background removal" write-ups recommend, it is built on BiRefNet, and it is
CC BY-NC 4.0. BiRefNet itself is MIT.

---

## Tier 1: adopt next

### 1. Spark, for the splat surfaces

**[sparkjsdev/spark](https://github.com/sparkjsdev/spark)**
(`@sparkjsdev/spark`, MIT, 3.6k stars, npm 2.1.0) from World Labs.

Today [src/splat-viewer.js](../src/splat-viewer.js) drives
`@mkkellogg/gaussian-splats-3d`, which reads `.ply`, `.splat`, and `.ksplat`,
and runs its own `Viewer` with its own renderer and controls, separate from the
rest of the app's three.js scene. Two consequences:

- **We cannot open the formats modern captures actually ship.** PlayCanvas's
  **SOG** is roughly 15-20x smaller than the equivalent PLY, and Niantic's
  **[spz](https://github.com/nianticlabs/spz)** (MIT) is about 10x smaller.
  A capture that is a 1 GB PLY is a ~42 MB SOG. On a page whose whole premise is
  "open any splat scene in a browser", not reading the compressed formats is the
  single biggest functional gap the viewer has.
- **Splats cannot share a scene with meshes.** Spark renders splats as ordinary
  `THREE.Object3D`s inside an existing scene, with correct depth sorting against
  mesh geometry, and supports transforms, color editing, displacement, and
  skeletal animation on splats.

Spark reads PLY (including compressed), SPZ, SPLAT, KSPLAT, and SOG.

**Where it lands:** [src/splat-viewer.js](../src/splat-viewer.js) (368 lines) and
`src/forge-studio/lab/lab.js`, the only two consumers of the current library.
The teardown path is the delicate part: the current file releases the WebGL
context by hand because the old library's `dispose()` stops short of it, and a
Spark object living in a normal scene changes that shape entirely.

**Why it matters beyond the viewer:** a splat that can live in the main avatar
scene is the missing half of item 3 below.

### 2. OpenTelemetry, for fleet observability

**[open-telemetry/opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js)**
(Apache-2.0, 3.5k stars).

The platform runs 115 Cloud Scheduler crons and 30-plus Cloud Run services, and
the only cross-cutting instrumentation is Sentry error capture
([api/_lib/sentry.js](../api/_lib/sentry.js)). There is no distributed trace, so
a slow `/forge` request that fans out to rembg, a mesh lane, rig, and texture
cannot be attributed to a stage without reading four services' logs by hand.

GCP has a first-party OTLP endpoint, so this is a pre-approved-surface adoption
with no new vendor: the Node SDK plus the Cloud Trace exporter in
[server/index.mjs](../server/index.mjs), and `traceparent` propagated on the
worker fetches in `api/_providers/gcp.js`.

**Where it lands:** `server/index.mjs` (boot), `api/_providers/gcp.js` (context
propagation to the workers), and each Python worker's FastAPI app for the far
end of the span.

### 3. LHM, for one-selfie photoreal humans

**[aigc3d/LHM](https://github.com/aigc3d/LHM)** (Apache-2.0, 2.7k stars,
ICCV 2025).

[workers/avatar-reconstruction](../workers/avatar-reconstruction/) fits a selfie
onto a fixed-topology Wolf3D template: MediaPipe landmarks, a TPS texture warp,
and a geometry morph. That is a sound, CPU-cheap, commercially clean design, and
it is bounded by the template. It cannot produce hair, clothing, or body shape
that the template does not already have.

LHM reconstructs an **animatable** 3D human from a single image and drives it
with SMPL-X pose, which is the interface our retargeter already thinks in.
Published inference times are 1.41 s (LHM-MINI, 16 GB), 2.01 s (LHM-500M), and
6.57 s (LHM-1B). It outputs 3D Gaussians, with a mesh export path.

This is why it is listed after Spark: LHM's native output is splats, and Spark
is what would let that render on the existing avatar stage next to GLB avatars
instead of in a walled-off viewer. Adopted together they are one feature,
"photoreal animatable avatar from one photo", not two.

**Where it lands:** a new GPU lane beside the existing reconstruction worker, not
a replacement. The template path stays as the CPU-cheap default and the
guaranteed-riggable fallback.

### 4. Real part segmentation

[workers/segment](../workers/segment/) is deliberately pure geometry: connected
components first, then geometric splitting. That is exactly right for an
assembled model and it has a known blind spot, which its own README is honest
about: a generative lane emits a single watertight blob, and connected-component
analysis has nothing to separate.

Two MIT options fill that in, and they solve different halves:

- **[wgsxm/PartCrafter](https://github.com/wgsxm/PartCrafter)** (MIT, 2.5k stars,
  NeurIPS 2025) generates the parts directly from a single image, so parts come
  out of the *generation* step rather than being recovered afterwards. That is a
  change to the forge pipeline, not to the segment worker.
- **[VAST-AI-Research/HoloPart](https://github.com/VAST-AI-Research/HoloPart)**
  (MIT, 665 stars) does amodal part completion: it recovers each part as a whole
  object, including the hidden geometry where parts meet, which is what makes a
  split part actually usable as a swappable component.

**Avoid [nv-tlabs/PartField](https://github.com/nv-tlabs/PartField).** It is the
best-known name in this space and its NVIDIA License clause 3.3 restricts use to
non-commercial research and educational purposes. It cannot ship here.

**Where it lands:** PartCrafter as a forge lane option; HoloPart as a stage
inside [workers/segment](../workers/segment/) that runs after the geometric
split when the caller asks for complete parts.

---

## Tier 2: worth a lane, not urgent

| Project | License | Why | Lands in |
|---|---|---|---|
| [DreamTechAI/Direct3D-S2](https://github.com/DreamTechAI/Direct3D-S2) | MIT (1.3k stars) | Sparse-voxel latent diffusion at gigascale resolution; a genuinely different geometry prior from TRELLIS and Hunyuan | New `workers/model-direct3d-s2`, as a peer of the existing mesh backends |
| [stepfun-ai/Step1X-3D](https://github.com/stepfun-ai/Step1X-3D) | Apache-2.0 (888 stars) | Two-stage geometry then texture, fully open including training code | Same, another forge backend |
| [huanngzh/MV-Adapter](https://github.com/huanngzh/MV-Adapter) | Apache-2.0 (1.3k stars, ICCV 2025) | [workers/texture](../workers/texture/) hand-rolls multiview consistency with SDXL plus ControlNet-Depth and a back-projection pass; MV-Adapter is a purpose-built multiview-consistent adapter for exactly that | `workers/texture/`, replacing the per-view generation step and keeping the existing UV bake |
| [microsoft/MoGe](https://github.com/microsoft/MoGe) | MIT (2.9k stars; GitHub misreports this as unlicensed, the LICENSE file is MIT) | Accurate monocular geometry, useful as a depth prior for image-to-3D conditioning and for `/capture` on a single photo | `workers/model-video2scene/` as a single-image path |
| [facebookresearch/map-anything](https://github.com/facebookresearch/map-anything) | Apache-2.0 (3.7k stars) | Universal feed-forward metric 3D reconstruction. Prefer it over VGGT, which is the more famous model in this category and is not permissively licensed (see below) | `workers/model-video2scene/`, beside LingBot-Map |
| [playcanvas/supersplat](https://github.com/playcanvas/supersplat) | MIT (10k stars) | A full splat editor. Once Spark lands, this is the reference for what a three.ws splat editing surface should do, and its SOG writer is the export path | Reference plus `@playcanvas/splat-transform` (MIT) as the server-side SOG encoder |
| [EricGuo5513/momask-codes](https://github.com/EricGuo5513/momask-codes) | MIT (1.3k stars) | [workers/model-text2motion](../workers/model-text2motion/) chose MDM over MoMask on license grounds; the repo is MIT, so that call is worth re-testing on quality. Check the HumanML3D training-data terms separately from the code license before acting | `workers/model-text2motion/mdm_sampler.py` is already the only model-specific file, by design |

---

## License traps

Every one of these is a well-known, high-star project that looks adoptable and
is not, or is not on the terms its popularity implies. Checked against the
actual LICENSE file, not the GitHub sidebar.

| Project | Reality |
|---|---|
| `briaai/RMBG-2.0` | CC BY-NC 4.0, commercial use needs a paid license. It is built on BiRefNet, which is MIT. Use BiRefNet |
| `nv-tlabs/PartField` | NVIDIA License 3.3: non-commercial research and education only |
| `facebookresearch/vggt` | Custom "VGGT License v1" with an Acceptable Use Policy and pass-through redistribution terms, not an OSI license. MapAnything (Apache-2.0) covers the same ground |
| `ByteDance-Seed/Depth-Anything-3` | Split licensing. DA3-SMALL, DA3-BASE, DA3MONO-LARGE, DA3METRIC-LARGE are Apache-2.0; DA3-LARGE, DA3-GIANT, and the DA3NESTED series are CC BY-NC 4.0. The repo code is Apache-2.0, so the checkpoint choice is the whole question |
| `zju3dv/GVHMR` | Custom Zhejiang University terms, not permissive |
| `graphdeco-inria/hierarchical-3d-gaussians` | Inherits the INRIA 3DGS license, which is non-commercial |

`microsoft/MoGe` is the inverse case: GitHub reports no license, and the LICENSE
file is plain MIT.

---

## Deliberately not recommended

- **A new JS 3D engine** (Babylon, PlayCanvas engine, Needle). three.js is the
  foundation and the entire `avatar-sdk` public contract. Spark is recommended
  precisely because it extends three.js instead of replacing it.
- **A client-side search library** (Orama, MiniSearch). Search here runs against
  Postgres over records the browser does not hold, and `@leeoniya/ufuzzy` already
  covers in-page filtering.
- **`transformers.js` as a general runtime.** `onnxruntime-web` is already the
  in-browser inference path and Kokoro TTS already runs on it. Adding a second
  runtime buys nothing unless a specific model needs it.
- **`spz-js`.** It is the obvious way to add `.spz` support without touching the
  renderer, and it depends on the entire `playcanvas` engine to do it. Spark
  reads `.spz` natively.
- **UniRig.** Already evaluated and retired here in favour of Make-It-Animatable
  (see [workers/rig/README.md](../workers/rig/README.md)); its live instance
  produced unusable 22-bone skeletons. Noting only that upstream has moved since
  that call, so it is a re-test candidate rather than a closed question.

---

## Re-running this sweep

The gap detection is a grep, and it is worth re-running whenever a lane is
rebuilt:

```bash
# Does the repo already use a given project, anywhere that matters?
grep -ril 'PartCrafter' src api workers packages services scripts | grep -v node_modules

# Verify a license and its activity from the source, not a blog.
curl -s https://api.github.com/repos/wgsxm/PartCrafter |
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);
    console.log(j.full_name, j.license?.spdx_id, j.stargazers_count, j.pushed_at)})"

# A NOASSERTION spdx_id means "GitHub could not classify it", not "no license".
# Read the file.
curl -s https://raw.githubusercontent.com/wgsxm/PartCrafter/main/LICENSE | head -20
```
