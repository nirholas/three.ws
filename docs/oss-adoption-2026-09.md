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

1. **Gap detection.** A presence sweep of roughly 250 candidate project names
   across `src/`, `api/`, `workers/`, `packages/`, `services/`, `scripts/`, and
   `server/`, in two rounds: one scoped to 3D and one across every other surface
   (audio, vision, LLM tooling, web infra, security, database, docs, i18n).
   Anything already wired was dropped, and that was most of the obvious list:
   Kokoro TTS, `@pixiv/three-vrm`, Make-It-Animatable, TRELLIS, Hunyuan3D
   2.0/2.1, TripoSG, MDM, QuadriFlow, xatlas, meshoptimizer, Colyseus, Yjs,
   Rapier, gltf-transform, onnxruntime-web. **This document only contains things
   the repo genuinely lacks.**
2. **Verification.** Every license, star count, and last-push date below came
   from the GitHub REST API or the npm registry directly, not from a blog. The
   "best of 2026" listicles were checked and discarded: several assert a
   "TRELLIS.2" release that does not exist in `microsoft/TRELLIS`. Where GitHub
   reports `NOASSERTION`, the LICENSE file itself was read.
3. **Measurement, where a claim was cheap to test.** The BiRefNet latencies were
   measured, not quoted, and the Spark migration was driven in a real browser.

Star counts are as of the sweep date and drift.

---

## Shipped in this pass

### 1. Spark, replacing the splat renderer

**[sparkjsdev/spark](https://github.com/sparkjsdev/spark)**
(`@sparkjsdev/spark`, MIT, 3.6k stars, by World Labs).

[/splat](https://three.ws/splat) ran on `@mkkellogg/gaussian-splats-3d`, which
reads `.ply`, `.splat`, and `.ksplat` and renders inside a private viewer of its
own. Three problems followed from that, and all three are fixed:

- **It could not open the formats real captures ship.** The same scene that is a
  1 GB PLY is roughly 100 MB as [SPZ](https://github.com/nianticlabs/spz) (MIT,
  Niantic) and roughly 42 MB as
  [SOG](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/)
  (PlayCanvas), 15 to 20 times smaller. Those are the files people are handed
  today and what SuperSplat exports. Both now load.
- **The format was guessed from the filename.** It is now read from the bytes,
  so a URL with a query string, a redirect, or no extension still decodes.
- **The camera sat at a fixed z=3.2 for every scene.** It now frames the splat
  centres in world space, which is the only thing that works across captures
  authored at wildly different scales.

Two things the migration surfaced that are worth writing down, because both look
like a broken page and neither is:

- Spark accumulates colour with premultiplied alpha and leaves destination alpha
  at zero. On a transparent canvas the browser composites a fully rendered scene
  away to nothing. The canvas has to be opaque.
- Spark sorts splats on a worker and only paints once that first sort lands, up
  to about a second on a weak GPU. The page now holds a "Sorting splats" state
  until Spark reports it has something to draw, with a timeout so a scene that
  never reports back is still handed over.

Verified in a real browser against `butterfly.spz` (177,132 splats) and both
procedural samples: correct framing, correct orientation, live splat counts in
the HUD, no console errors.

`@mkkellogg/gaussian-splats-3d` stays a dependency: the Forge Studio Lab still
uses it, and moving that surface is separate work.

### 2. BiRefNet as an optional background-removal model

**[ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet)** (MIT, 4.2k
stars).

The [rembg worker](../workers/rembg/) ran four DIS/U2Net-family models. Those
smear a soft boundary (hair, fur, foliage, a thin strap) into a halo, and since
every image-to-3D lane reconstructs geometry from the matted subject, that halo
becomes real polygons on the finished mesh.

The pinned `rembg==2.0.59` already ships BiRefNet sessions; the worker's model
allowlist simply did not include them. `birefnet-general-lite` is now a
selectable model (short alias `birefnet`) across the worker,
`api/forge-rembg.js`, the x402 pipeline, the service catalog, and the MCP studio
tool.

Measured on 4 threads with the repo's pinned `onnxruntime==1.28.0`, best of three
warm runs at 677x1024:

| Model | Weights | Latency |
|---|---|---|
| `isnet-general-use` (default) | 170 MB | 1.0 s |
| `birefnet-general-lite` | 214 MB | 6.0 s |

Six times the compute is worth it on a hero image and not worth it on a batch,
so the default is unchanged and the policy tests pin it that way. Details:
[workers/rembg/README.md](../workers/rembg/README.md).

Note the license trap this avoids: **RMBG-2.0** is the model most "best
background removal" write-ups recommend, it is built on BiRefNet, and it is
CC BY-NC 4.0. BiRefNet itself is MIT.

---

## Tier 1: adopt next

### OpenTelemetry, for fleet observability

**[open-telemetry/opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js)**
(Apache-2.0, 3.5k stars).

The platform runs 115 Cloud Scheduler crons and 30-plus Cloud Run services, and
the only cross-cutting instrumentation is Sentry error capture
([api/_lib/sentry.js](../api/_lib/sentry.js)). There is no distributed trace, so
a slow `/forge` request that fans out to rembg, a mesh lane, rig, and texture
cannot be attributed to a stage without reading four services' logs by hand.

GCP has a first-party OTLP endpoint, so this is a pre-approved-surface adoption
with no new vendor.

**Where it lands:** [server/index.mjs](../server/index.mjs) (boot),
`api/_providers/gcp.js` (propagating `traceparent` to the workers), and each
Python worker's FastAPI app for the far end of the span.

### LHM, for one-selfie photoreal humans

**[aigc3d/LHM](https://github.com/aigc3d/LHM)** (Apache-2.0, 2.7k stars,
ICCV 2025).

[workers/avatar-reconstruction](../workers/avatar-reconstruction/) fits a selfie
onto a fixed-topology Wolf3D template: MediaPipe landmarks, a TPS texture warp,
and a geometry morph. That is a sound, CPU-cheap, commercially clean design, and
it is bounded by the template. It cannot produce hair, clothing, or body shape
the template does not already have.

LHM reconstructs an **animatable** 3D human from a single image and drives it
with SMPL-X pose, which is the interface our retargeter already thinks in.
Published inference times are 1.41 s (LHM-MINI, 16 GB), 2.01 s (LHM-500M), and
6.57 s (LHM-1B). It outputs 3D Gaussians, with a mesh export path.

This moved up the list the moment Spark shipped: LHM's native output is splats,
and Spark is what lets that render on the existing avatar stage next to GLB
avatars instead of in a walled-off viewer. Together they are one feature,
"photoreal animatable avatar from one photo".

**Where it lands:** a new GPU lane beside the existing reconstruction worker, not
a replacement. The template path stays as the CPU-cheap default and the
guaranteed-riggable fallback.

### Real part segmentation

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
  split part usable as a swappable component.

**Avoid [nv-tlabs/PartField](https://github.com/nv-tlabs/PartField).** It is the
best-known name in this space and its NVIDIA License clause 3.3 restricts use to
non-commercial research and education. It cannot ship here.

### Audio2Face-3D, for real facial performance

**[NVIDIA/Audio2Face-3D](https://github.com/NVIDIA/Audio2Face-3D)**, open-sourced
in 2025 under the **NVIDIA Open Model License** (not an OSI license: read it
before committing, and see the trap table below).

Our avatars already ship the 52 ARKit blendshapes and 15 visemes
([workers/avatar-reconstruction](../workers/avatar-reconstruction/)), and lipsync
today is `wawa-lipsync` estimating visemes from the audio signal. Audio2Face-3D
is a 180M-parameter audio-to-facial-motion model, and NVIDIA's microservice form
of it emits ARKit blendshapes directly, which is the exact rig we already drive.
That is the difference between mouth shapes that track the audio and a facial
performance with jaw, tongue, and eyes.

It wants an NVIDIA GPU with TensorRT, which the fleet already has, and three.ws
is already in NVIDIA Inception, so the relationship for a license question exists.

**Where it lands:** a GPU worker producing an ARKit-52 blendshape track, consumed
by the existing lipsync path in `src/` alongside the cheap `wawa-lipsync`
fallback, the same way BiRefNet sits beside isnet: quality tier, not default.

---

## Tier 2: worth a lane, not urgent

| Project | License | Why | Lands in |
|---|---|---|---|
| [DreamTechAI/Direct3D-S2](https://github.com/DreamTechAI/Direct3D-S2) | MIT (1.3k) | Sparse-voxel latent diffusion at gigascale resolution; a genuinely different geometry prior from TRELLIS and Hunyuan | New `workers/model-direct3d-s2`, peer of the existing mesh backends |
| [stepfun-ai/Step1X-3D](https://github.com/stepfun-ai/Step1X-3D) | Apache-2.0 (888) | Two-stage geometry then texture, fully open including training code | Same, another forge backend |
| [huanngzh/MV-Adapter](https://github.com/huanngzh/MV-Adapter) | Apache-2.0 (1.3k) | [workers/texture](../workers/texture/) hand-rolls multiview consistency with SDXL plus ControlNet-Depth and a back-projection pass; MV-Adapter is a purpose-built multiview-consistent adapter for exactly that | `workers/texture/`, replacing the per-view generation step, keeping the UV bake |
| [microsoft/MoGe](https://github.com/microsoft/MoGe) | MIT (2.9k; GitHub misreports it as unlicensed, the LICENSE file is MIT) | Accurate monocular geometry as a depth prior for image-to-3D conditioning and for `/capture` from a single photo | `workers/model-video2scene/` as a single-image path |
| [facebookresearch/map-anything](https://github.com/facebookresearch/map-anything) | Apache-2.0 (3.7k) | Universal feed-forward metric 3D reconstruction. Prefer it over VGGT, the more famous model in this category, which is not permissively licensed | `workers/model-video2scene/`, beside LingBot-Map |
| [playcanvas/supersplat](https://github.com/playcanvas/supersplat) + `@playcanvas/splat-transform` | MIT (10k) | Now that Spark reads SOG, this is the encoder that writes it and the reference for a three.ws splat editing surface | A server-side SOG encode step, so captures are served compressed |
| [facebookresearch/sam2](https://github.com/facebookresearch/sam2) | Apache-2.0 (19.8k) | Promptable image and video segmentation. The `/motion-swap` mask lane and any "select this object" tool are both SAM-shaped problems | `workers/model-video2motion/` mask stage |
| [EricGuo5513/momask-codes](https://github.com/EricGuo5513/momask-codes) | MIT (1.3k) | [workers/model-text2motion](../workers/model-text2motion/) chose MDM over MoMask on license grounds; the repo is MIT, so that call is worth re-testing on quality. Check the HumanML3D training-data terms separately from the code license | `workers/model-text2motion/mdm_sampler.py` is already the only model-specific file, by design |

---

## Beyond 3D: what the second sweep found

The 3D sweep is where the product lives, but the wider sweep turned up gaps that
have nothing to do with rendering and are cheaper to close.

### Supply chain and secrets: nothing off the shelf is installed

`scripts/check-secrets.mjs` is a good hand-rolled push-time scan, and there is no
dependency-vulnerability or static-analysis tooling at all. Three drop-ins, all
of which run locally and none of which need GitHub Actions (which this repo does
not use):

- **[google/osv-scanner](https://github.com/google/osv-scanner)** (Apache-2.0,
  11k) reads `package-lock.json` and the Python requirements files and reports
  known vulnerabilities. The `overrides` block in `package.json` shows this work
  is already being done by hand, one CVE at a time.
- **[gitleaks/gitleaks](https://github.com/gitleaks/gitleaks)** (MIT, 29k) as a
  second opinion beside the existing secrets check, which is worth having on a
  repo where a leaked key is a live wallet.
- **[semgrep/semgrep](https://github.com/semgrep/semgrep)** (LGPL-2.1, 16.5k) for
  the rules the custom `check:rules` cannot express. Note the LGPL: run it as a
  tool, do not vendor it into shipped code.

### Dead code: [webpro-nl/knip](https://github.com/webpro-nl/knip) (ISC, 12k)

"Delete aggressively" is a stated operating rule, and nothing mechanically
enforces it across 60-plus top-level directories, ~90 workspace packages, and
1,989 test files. Knip finds unused files, exports, and dependencies in exactly
this shape of monorepo. Expect a large first report; the value is in the
dependency and export findings, not the file list.

### Voice, if the neural TTS lane ever needs to grow

Kokoro already ships as the free in-browser voice, which was the right call and
covers the common case. If a lane ever needs zero-shot voice cloning or more
expressive delivery, the permissively licensed options are
**[resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox)** (MIT,
26k) and **[canopyai/Orpheus-TTS](https://github.com/canopyai/Orpheus-TTS)**
(Apache-2.0, 6.3k). **F5-TTS is the one to avoid**: its weights are CC BY-NC.
For speech-in, **[SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)**
(MIT, 25k) is the standard server-side Whisper runtime.

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
| `ByteDance-Seed/Depth-Anything-3` | Split licensing. DA3-SMALL, DA3-BASE, DA3MONO-LARGE, DA3METRIC-LARGE are Apache-2.0; DA3-LARGE, DA3-GIANT and the DA3NESTED series are CC BY-NC 4.0. The repo code is Apache-2.0, so the checkpoint choice is the whole question |
| `SWivid/F5-TTS` | Weights are CC BY-NC. Chatterbox (MIT) and Orpheus (Apache-2.0) are the commercial-safe equivalents |
| `NVIDIA/Audio2Face-3D` | NVIDIA Open Model License. Permissive in intent and not OSI-approved; read it and record the read before the lane ships |
| `zju3dv/GVHMR` | Custom Zhejiang University terms, not permissive |
| `graphdeco-inria/hierarchical-3d-gaussians` | Inherits the INRIA 3DGS license, which is non-commercial |
| `semgrep/semgrep` | LGPL-2.1. Fine as a developer tool, not as vendored code |

`microsoft/MoGe` is the inverse case: GitHub reports no license, and the LICENSE
file is plain MIT.

---

## Deliberately not recommended

- **A new JS 3D engine** (Babylon, PlayCanvas engine, Needle). three.js is the
  foundation and the entire `avatar-sdk` public contract. Spark was adopted
  precisely because it extends three.js instead of replacing it.
- **A client-side search library** (Orama, MiniSearch). Search here runs against
  Postgres over records the browser does not hold, and `@leeoniya/ufuzzy` already
  covers in-page filtering.
- **`transformers.js` as a general runtime.** `onnxruntime-web` is already the
  in-browser inference path and Kokoro TTS already runs on it. A second runtime
  buys nothing unless a specific model needs it.
- **`spz-js`.** It is the obvious way to add `.spz` support without touching the
  renderer, and it pulls in the entire `playcanvas` engine to do it. Spark reads
  `.spz` natively.
- **UniRig.** Already evaluated and retired here in favour of Make-It-Animatable
  (see [workers/rig/README.md](../workers/rig/README.md)); its live instance
  produced unusable 22-bone skeletons. Upstream has moved since that call, so it
  is a re-test candidate rather than a closed question.
- **A JS linter swap** (oxlint, Biome). Prettier plus the custom `check:rules`
  already covers what this repo enforces, and the rules that matter here are
  house rules no off-the-shelf linter knows.

---

## Re-running this sweep

The gap detection is a grep, and it is worth re-running whenever a lane is
rebuilt:

```bash
# Does the repo already use a given project, anywhere that matters?
grep -ril 'PartCrafter' src api workers packages services scripts server | grep -v node_modules

# Verify a license and its activity from the source, not a blog.
curl -s https://api.github.com/repos/wgsxm/PartCrafter |
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);
    console.log(j.full_name, j.license?.spdx_id, j.stargazers_count, j.pushed_at)})"

# A NOASSERTION spdx_id means "GitHub could not classify it", not "no license".
# Read the file. This is where the traps above were found.
curl -s https://raw.githubusercontent.com/wgsxm/PartCrafter/main/LICENSE | head -20
```
