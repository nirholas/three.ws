# Forge: text and image to 3D, on a free-first engine grid

Forge is three.ws's text-and-image-to-3D generator. Type a prompt, drop in one to six photos of an object, or sketch a shape and name it, and Forge returns a downloadable, textured GLB you can orbit, view in AR, and take anywhere. It runs on a grid of real generation engines with live health status, and it is free-first by design: text prompts and photos both default to our own zero-cost GPU reconstruction workers, free hosted lanes stand behind them, and the paid engines stay explicitly selectable for when you want a specific vendor.

Page: [/forge](https://three.ws/forge) and the feature landing [/features/forge](https://three.ws/features/forge) · API: `/api/forge`

## Why it exists

Every other text-to-3D tool makes you choose a vendor, buy credits, and hope the one model they wired up is the right one for your prompt. Forge inverts that. It treats generation as a routing problem over many engines, picks the best free lane for the input you gave it, degrades gracefully when an upstream is down, and only ever charges for higher quality, never to recover a vendor bill. The result is a single surface where a first-time visitor can make a real 3D model in seconds with no account, no key, and no cost, while a power user can pin a specific engine, bring their own key, or push a High-tier generation through multi-view fusion.

Forge is the public, auth-free twin of the 3D Studio MCP server (`api/mcp-3d.js`), so anything the page can do, an agent can do over MCP or a plain HTTP call.

## How it works

A generation request is described by two orthogonal axes, resolved in `api/_lib/forge-tiers.js`, the single source of truth shared by the endpoint, the catalog the UI renders, and every provider param builder.

**The path** is how geometry is produced:

- `image` (image-intermediate, the fast default): text is painted into a reference view (FLUX/Imagen) and reconstructed to a mesh, or your own photo is reconstructed directly.
- `geometry` (geometry-first): a native 3D model emits mesh directly from the prompt or a single photo, so detail isn't capped by what one image implies. This is the Meshy and Tripo text-to-3D path.
- `sketch` (sketch-conditioned): a drawing plus a prompt naming what it depicts drives TripoSG-scribble straight to geometry, no photo and no intermediate view.

**The tier** is how much geometric budget to spend:

| Tier | Poly target | Textures | Price (direct USDC) | Notes |
| --- | --- | --- | --- | --- |
| Draft | 12,000 | none | $0.05 | Fast, low-poly. Blockout and iteration. |
| Standard | 30,000 | 2K | $0.15 | Balanced, multi-angle reference fusion. The default. |
| High | 200,000 | PBR + HD | $0.50 | Maximum detail, deepest sampler budget, multi-view fusion. |

### The engine grid

Each backend declares which paths it serves, whether it needs a bring-your-own-key (BYOK) credential, and its per-(path, tier) cost and latency estimates so the UI can show the trade-off before you commit. The live registry (`BACKENDS` in `api/_lib/forge-tiers.js`):

- **TRELLIS (free)** on NVIDIA NIM (Microsoft TRELLIS). Zero vendor cost, and the last free lane in the chain: it serves a text prompt when every self-host worker and Space is cold or down. Text-only, so it rejects user photos and photo submissions route elsewhere.
- **Hunyuan3D / TRELLIS (free)** on Hugging Face Spaces. The free photo-to-3D lane and a High-tier engine, with automatic failover across Hunyuan3D 2.1, Hunyuan3D 2, TRELLIS, and TripoSR. Queue waits vary.
- **TRELLIS (self-host)** and **Hunyuan3D (self-host)**, our own scale-to-zero Cloud Run GPU workers, and the named defaults: TRELLIS at Draft and Standard, Hunyuan3D at High. Zero vendor cost, so free-first routing prefers them first. Self-host TRELLIS is a native single-hop image-to-3D lane; Hunyuan3D leads on people and organic subjects.
- **TripoSG (self-host)**, the sketch-only scribble worker. Untextured geometry from a drawing. It also serves photos as the last automatic failover rung: when every textured photo lane has failed mid-job, the job continues on TripoSG's photo pipeline and returns the shape without textures rather than failing.
- **Pixal3D (self-host)**, the fidelity lane, labeled **"Match my photo"** in the UI. Built on [TencentARC Pixal3D](https://github.com/TencentARC/Pixal3D) (MIT), pixel-aligned image-to-3D on [Microsoft TRELLIS.2](https://github.com/microsoft/TRELLIS.2)'s backbone. Where the other photo lanes read one view and generate a plausible result, Pixal3D fuses every photo you give it (1 to 4), so the result matches your photos rather than guessing. Never a named default or a failover target (a down Pixal3D must not silently drop the 2nd/3rd photo on a lane that only reads the first view) and only selectable explicitly. With exactly one photo, the optional `fill_other_sides` flag first synthesizes the other three angles with [MV-Adapter](https://github.com/huanngzh/MV-Adapter) (Apache-2.0) before reconstructing.
- **AniGen (self-host)**, the rig-on-generation lane, labeled **"Rig on generate"** in the UI. Built on [VAST-AI-Research/AniGen](https://github.com/VAST-AI-Research/AniGen) (MIT). Every other image lane hands back a bare mesh; AniGen predicts the mesh, its joint skeleton and its per-vertex skin weights together, so the GLB it returns is already animatable, no separate rerig call. Single reference image; never a named default or a failover target, only selectable explicitly. The catalog's `rigged:true` flag and the poll response's `rigged`/`joint_count` fields mark the result as pre-rigged.
- **PartCrafter (self-host)**, the editable-parts lane, labeled **"Editable parts"** in the UI. Built on [PartCrafter](https://github.com/wgsxm/PartCrafter) (MIT). Every other image lane hands back one undivided mesh; PartCrafter decodes a reference photo straight into N individually named part meshes in a single diffusion-transformer pass, so the result opens directly in Restyle Studio's part picker: select a part, recolor, swap or regenerate it, and reassemble into one model without touching the rest. Single reference image; never a named default or a failover target, only selectable explicitly. The poll response's `parts`/`part_count`/`parts_manifest_url` fields carry the per-part manifest.
- **TRELLIS** on Replicate, a paid platform lane. Selectable explicitly and used as the last-resort fallback only on deployments with no free engine configured.
- **Meshy 6**, **Tripo v3.1**, **Rodin (Hyper3D)**, BYOK geometry-first engines with quad topology and a real poly target. You supply your own key.
- **Stable Fast 3D** (Stability, BYOK) and **Replicate (your account)** (BYOK), single-image reconstruction lanes.

### The Tripo house lane

Tripo v3.1 runs two ways. Paste your own key and it is a BYOK engine like Meshy or Rodin,
billed to nothing of ours. Set `TRIPO_API_KEY` on the deployment and the same lane becomes
a High-tier default and an explicit "Tripo" engine choice, billed to $THREE credits like
the other house lanes; leave the variable unset and routing and the engine list are exactly
what they were before it existed. The provider speaks Tripo's v3 REST API
(`openapi.tripo3d.com/v3`): dedicated endpoints per capability, a unified `input` field, and
the unified `{code, message, suggestion, request_id}` error envelope.

A finished job can complete two ways. The client polls `GET /api/forge?job=<id>` the same
as any other async lane, or Tripo's own signed webhook (`api/forge/webhook/tripo.js`)
delivers the result first; the receiver verifies `Tripo-Webhook-Signature`, claims
`Tripo-Webhook-Delivery` so a retried delivery cannot double-complete a job, and finishes
it the same way a poll would. Polling always still works, so a missing or misconfigured
webhook degrades to the slower path, never a stuck job.

Every Tripo result, BYOK or house key, names the exact model version it ran on
(`TRIPO_MODEL_VERSION`, or the provider's current default) in the submit, poll, and gallery
responses, and in the exported GLB's own `asset.extras.engine`/`engineVersion` metadata, so
a model you download still says which engine and version made it after the gallery entry is
gone. `npm run forge:tripo` reports the house lane's own health, completion rate and median
latency by day, scoped to `backend = 'tripo'`, separately from `npm run forge:funnel`'s
all-backend numbers.

See [the Tripo partner note](./partners/tripo.md) for the partnership context and what is
and is not wired yet (low-poly/quad game-ready preset and Smart Segmentation are built on
self-hosted GCP workers instead; no live Tripo splat endpoint exists to wire).

### Free-first routing with live health

Routing (`resolveBackendIdWithHealth`) walks an ordered list of every free lane that could serve the request on this deployment, most preferred first: the tier's named free engine, then the per-path fallback chain (our own GPU workers, then the free external Spaces, then the free NVIDIA lane as the final health-gated safety net). Draft and Standard name our self-host TRELLIS worker; High names our self-host Hunyuan3D worker. The free NVIDIA NIM lane is never a named default: reconstructing straight from a truncated prompt with no photoreal reference is the realism hole this ordering closes, so it trails as the final health-gated fallthrough (and stays explicitly selectable). A subject classifier reorders the two self-host PBR lanes for hard-surface versus organic prompts. Every entry is env-gated, so the list degrades cleanly on partial deployments.

Health is real. The UI fetches `/api/forge?health=1` after load and disables any lane whose upstream is down, with the actual reason, instead of failing after you have typed a prompt and clicked Generate. A short circuit-breaker cooldown sidelines a degraded lane (for example the free NIM lane after a gateway timeout) so subsequent requests skip it and go straight to a working engine; the cooldown expires on its own so a recovered lane is retried promptly. There are no mock paths: if a selected backend isn't configured the endpoint returns a clean `backend_unconfigured` error, never a fake result.

### Background generation and resume

Generation is a job. `POST /api/forge` returns a `job_id`; the client polls `GET /api/forge?job=<id>` until the status is `done` or `failed`. The lanes that complete inline within one request (free NVIDIA NIM, HuggingFace Spaces, BYOK-sync) can instead answer the POST directly with `status:'done'`, the `glb_url`, and a null `job_id`, and they retry once automatically on a failed result. Because the in-flight job id is written to `localStorage`, closing the tab or navigating away does not lose the generation: returning to Forge within a 30-minute window resumes polling the same job. Finished models for your browser are surfaced from a gallery on load, and a share link always wins over a resume.

### Watching a generation happen

`POST /api/forge` is one long request, and most of the wait lives inside it: the
art-director pass rewrites your prompt, a text-to-image model paints the
photoreal reference view the mesh is reconstructed from, and the fusing lane
paints turnaround views around it. All of that finishes before the response can
carry a job id, so a page with nothing but the response to go on could only say
"art-directing your prompt" for the whole window and then reveal the reference
image at the very end, when it had in fact existed for half a minute.

So the generation records a crumb the instant each of those milestones genuinely
finishes, and the page reads them while its own POST is still open:

```bash
# 1. Mint any url-safe id, 16 to 64 characters, and send it with the request.
TRACE=$(uuidgen | tr -d '-')
curl -sS -X POST https://three.ws/api/forge \
  -H 'content-type: application/json' \
  -d "{\"prompt\":\"a brass sundial on a stone base\",\"progress_id\":\"$TRACE\"}" &

# 2. While that runs, read what the pipeline has already finished.
curl -sS "https://three.ws/api/forge?progress=$TRACE"
# → {"progress":[
#      {"stage":"directed","at":1757345001000,"directed_prompt":"a brass sundial on a weathered limestone base, aged patina, studio softbox lighting, plain seamless backdrop"},
#      {"stage":"reference","at":1757345013000,"preview_image_url":"https://…/ref.jpg","text_to_image_model":"vertex-gemini-2.5-flash-image"},
#      {"stage":"views","at":1757345024000,"view_count":3},
#      {"stage":"submitting","at":1757345027000}
#    ]}
```

The four stages are `directed` (the art-director pass is over, and
`directed_prompt` is null when it left your words alone), `reference` (the view
the mesh is reconstructed from now exists), `views` (the turnaround views the
fusing lane adds, only when the lane painted any), and `submitting` (every image
is stored and the job is going to a GPU). Nothing here is predicted: a crumb is
written after the work it names returned, never on a timer.

The channel is optional in every direction. Omit `progress_id` and the request
behaves exactly as it always has. Poll a trace with no crumbs yet and you get an
empty list, which is indistinguishable from "not there yet" on purpose. Crumbs
expire after five minutes, and they only ever hold what the response itself
carries moments later, so a trace id grants no access to anything.

### Saying what a model is for

Under a finished model, a "Making this for" row offers Game, Web, Avatar,
Simulation, Print, AR and Just playing. It is optional and one tap. The answer is
remembered in your browser and attached to your later generations, so you are
asked once, not every time. It tells us which kinds of work Forge serves well and
which it does not, broken out by use instead of one blended number.

API callers can send the same thing as `destination`. An unrecognised value is
ignored, never an error:

```bash
curl -sS -X POST https://three.ws/api/forge \
  -H 'content-type: application/json' \
  -d '{"prompt":"a low-poly wooden barrel","destination":"game"}'
```

### Comparing two engines on one prompt

The engine grid is only useful if you can see what choosing an engine actually
changes. Once your gallery holds two models, a **Compare** control appears above
it. Turn it on, pick any two creations, and they open side by side in two
viewers, each labelled with the engine and tier that produced it.

Camera orbit is synced across both panes, so turning one turns the other. Only
the orbit angles are shared, never the distance: two generations of one prompt
routinely differ in scale, and model-viewer frames each at its own radius, so
copying an absolute distance across would zoom one model into its own interior.
Each pane keeps the distance that frames it and turns in lockstep. Untick **Sync
cameras** to inspect one model on its own.

When your gallery contains the same prompt run on two *different* engines, a
hint above the grid points it out, because that is the comparison worth making.
Two runs of one prompt on one engine is a re-roll, not an engine comparison, and
the hint deliberately stays quiet for it (`findComparablePrompts` in
[src/forge-compare.js](../src/forge-compare.js), covered by
[tests/forge-compare.test.js](../tests/forge-compare.test.js)).

### Reel: video and stills, rendered in your browser

A GLB is the wrong thing to send someone who just wants to see what you made.
The **Reel** button on the result bar (or the `R` key) renders a cinematic pass
over the finished model and hands back three real files:

| File | What it is | Where it goes |
| --- | --- | --- |
| `<name>-<shot>-reel.mp4` | The video, 30fps, MP4 where the browser can encode it and WebM otherwise | Slides, posts, a landing page `<video>` |
| `<name>-<shot>-hero.png` | The shot's hero frame on the reel backdrop | Thumbnails, link previews |
| `<name>-<shot>-cutout.png` | The same frame with a transparent background | Dropping the model onto any design |

Three shots ship. **Turntable** is one clean revolution whose last frame lands
exactly on its first, so it loops without a jump. **Hero push** opens wide and
dollies into a three-quarter hero angle. **Low reveal** rises from below the
horizon. Aspect is 16:9, 1:1 or 9:16, and length is 4, 8 or 12 seconds.

Everything runs client side. Nothing is uploaded, no job is queued, and no
server renders anything, so a reel costs nothing and works while you are signed
out.

Two implementation choices are worth knowing because they are what make the
output trustworthy:

- **Reel renders its own pass rather than recording the page's viewer.**
  `<model-viewer>` runs a single shared WebGL canvas across every viewer on a
  page and moves it between shadow roots as visibility changes, so a canvas
  stream taken from it can carry zero frames while still reporting a clean
  recording. Owning the canvas also means the output is exactly the resolution
  you picked instead of your window size times your display's pixel ratio. The
  lighting is not a reimplementation: tone mapping, the HDRI environment and the
  ground contact shadow all come from
  [src/shared/cinematic-render.js](../src/shared/cinematic-render.js), the same
  module behind [/irl](https://three.ws/irl) and the avatar viewers.
- **The shot is paced to a fixed timestep.** Frames are rendered one at a time
  and pushed to the encoder on a wall-clock schedule, so a slow laptop produces
  the same 4-second reel as a fast desktop rather than a shorter, jerkier one.

Camera tracks are expressed in multiples of the model's own framed distance, so
a ring and a cathedral get the same shot rather than the same numbers, and the
framing distance accounts for the aspect: a 9:16 frame is limited by its
horizontal field of view, and ignoring that is exactly how a vertical reel crops
the subject's head off. The sampler, the framing maths, the codec preference and
the filenames live in [src/forge-reel.js](../src/forge-reel.js) and are covered
by [tests/forge-reel.test.js](../tests/forge-reel.test.js).

If a browser has no canvas video encoder, Reel says so and still produces both
stills; it never reports a recording that did not happen.

## Walkthrough

1. Open [/forge](https://three.ws/forge). No login, no wallet, no key required.
2. Pick an input mode: **Describe it** (text), **From photos**, or **From a sketch** (the sketch tab appears only when the TripoSG worker is configured).
3. For text, type a prompt like `a weathered brass diving helmet`. For photos, add one to six images of the same object from different angles (front, back, left, right, top, three-quarter); each uploads straight to object storage via a presigned URL and the public URLs are fused with multi-view conditioning.
4. Optionally open the quality controls and pick a tier (Draft, Standard, High) and an engine. The default engine carries a **FREE** pill. Down lanes are disabled with the reason shown.
5. Click Generate. A real elapsed-driven progress line runs against the catalog's ETA estimate for the chosen path, tier, and engine.
6. When the model lands, orbit it in the viewer, view it in AR, download it in any of seven formats (see [Download formats](#download-formats)), or run the post-generation tools (stylize, optimize with in-browser repair, smoothing and decimation (see [Mesh tools](#mesh-tools-repair-smooth-decimate)), Game-Ready retopology, split). Send it to a 3D printer from the format menu's slicer rows (see [Open in a slicer](#open-in-a-3d-printing-slicer)). Press `R` (or click **Reel**) to render a shareable video and stills of it without leaving the page.
7. Keep going on the same result: **Rig for animation** adds a humanoid skeleton (POST `/api/forge?action=rig`) and hands off to Pose Studio or IRL placement; **Restyle materials** re-skins the surface with a free-text instruction or a preset chip (chrome, wood, gold, neon, marble, rust) via `/api/material-studio`, keeping the mesh untouched; **Iterate** makes a shape-changing edit from a plain-language instruction ("make the helmet red", "add a backpack") via `/api/forge-iterate` (the same conversational core the `refine_model` MCP tool uses) and keeps every version in a branchable lineage strip; **Place IRL** opens `/irl?avatar=<glb_url>` to anchor the model in AR at a real-world location.

## Download formats

The Download button always hands back the source GLB immediately. The caret
beside it opens a format menu with seven targets:

| Format | Converted | Use it for |
|---|---|---|
| GLB | nothing to convert | The source. Textures embedded, works anywhere glTF does. |
| OBJ | in your browser | Universal geometry + UVs for Blender, Maya, C4D. No materials. |
| STL | in your browser | Solid geometry for 3D printing and CAD. Binary. |
| PLY | in your browser | Vertex-level data for scanning and point-cloud tools. Binary. |
| USDZ | in your browser | Textured AR asset. Opens directly on iPhone and Vision Pro. |
| FBX | on the server | Rigged interchange for Unity, Unreal and Maya. Keeps the skeleton, skin weights and blendshapes. |
| 3MF | on the server | Manufacturing package for slicers and print services. |

The first five are converted by three.js exporters in the page: no upload, no
queue, and the parsed scene is cached so switching formats does not re-download
the model. FBX and 3MF have no browser exporter, so they are authored by the
remesh worker from the source GLB. A server conversion is a real job: it shows
progress while it runs, names the reason if it fails, and leaves a
"download again" link for a minute in case the browser missed the download.

Both server formats are the same conversion the API exposes directly, so an
agent can ask for one without going through the page:

```bash
# Convert an existing GLB to FBX (geometry untouched, rig preserved).
curl -sX POST https://three.ws/api/forge-remesh \
  -H 'content-type: application/json' \
  -d '{"mesh_url":"https://.../model.glb","operation":"convert","output_format":"fbx"}'
# → 202 { "job_id": "...", "status": "queued" }

# Poll it. Terminal states are "done" (with result_url) and "failed" (with error).
curl -s 'https://three.ws/api/forge-remesh?job=<job_id>'
```

`output_format` accepts `glb`, `obj`, `stl`, `ply`, `usdz`, `3mf` and `fbx`.
`operation: "convert"` re-containers the mesh without touching its geometry;
drop it to remesh and convert in one pass (see
[3d-asset-pipeline.md](3d-asset-pipeline.md)).

`mesh_url` can point at a GLB, GLTF, OBJ, STL, PLY, OFF, DAE or binary FBX
(7.1 or later). That makes remesh the way in for an FBX: stylize and segment do
not read FBX (`/api/forge-stylize` and `/api/forge-segment` answer
`400 unsupported_mesh_format`), so convert it to GLB first and stylize or
segment the result.

```bash
# FBX in, GLB out, ready for /api/forge-stylize or /api/forge-segment.
curl -sX POST https://three.ws/api/forge-remesh \
  -H 'content-type: application/json' \
  -d '{"mesh_url":"https://.../character.fbx","operation":"convert","output_format":"glb"}'
```

A job that fails because of the file itself (an ASCII FBX, a corrupt one)
reports `status: "failed"` with an `error` that says what to re-export.

## Editable parts: swap, recolor or complete one part

A model with named part nodes (from the `partcrafter` backend above, or from
`/api/forge-segment`) opens in Restyle Studio with a **Parts** panel listing
every part. Selecting one scopes every material tool (presets, AI restyle,
manual sliders) to that part alone, and two actions replace its geometry
outright while keeping the rest of the model and the part's node name
untouched:

- **Swap part**: upload a replacement GLB/GLTF from your machine.
- **Regenerate part**: send the part's current geometry to
  `/api/forge-holopart`, which completes whatever geometry is hidden or was
  cut off at the segmentation seam, and swaps the result back in.

```bash
curl -sX POST https://three.ws/api/forge-holopart \
  -H 'content-type: application/json' \
  -d '{"mesh_url":"https://.../part_02.glb"}'
# → 202 { "job_id": "...", "status": "queued", "eta_seconds": ... }

curl -s 'https://three.ws/api/forge-holopart?job=<job_id>'
# → { "job_id": "...", "status": "done", "result_url": "https://.../part_02-complete.glb", ... }
```

`mesh_url` must already carry at least two named part geometries (the shape
`/api/forge-segment` and the `partcrafter` backend both produce); FBX is
rejected the same way stylize and segment reject it.

### Image to splat (TripoSplat)

`/api/forge-splat` turns one reference image into a 3D Gaussian splat with
[TripoSplat](https://github.com/VAST-AI-Research/TripoSplat) (MIT code and
weights), served by `workers/model-triposplat`. The result is a `.splat` plus a
`.ply`, and opens straight in the Splat Viewer.

```bash
curl -sX POST https://three.ws/api/forge-splat \
  -H 'content-type: application/json' \
  -d '{"image_url":"https://.../house.webp","num_gaussians":131072}'
# → 202 { "job_id": "...", "status": "queued", "eta_seconds": 45 }

curl -s 'https://three.ws/api/forge-splat?job=<job_id>'
# → { "status": "done", "splat_url": "https://.../t.splat", "ply_url": "https://.../t.ply",
#     "num_gaussians": 131072, "viewer_url": "/splat?src=..." }
```

`num_gaussians` is 8192 to 262144 (default 131072): fewer is lighter to render,
more is sharper. Returns 503 `unconfigured` until `MODEL_TRIPOSPLAT_URL` and
`GCP_RECONSTRUCTION_KEY` point at the deployed worker.

**Regenerate part keeps the rig.** Before the regenerated part is swapped
into the live model, Restyle Studio diffs the whole-model bytes HoloPart
received against the whole-model bytes it returned with
`@three-ws/glb-diff` (`api/_lib/preserve-contract.js`, declaring
`['skeleton', 'clips']`), and refuses the swap if the armature or any
animation clip changed. A successful regenerate is also minted as a new
durable version in the real lineage automatically (no separate "Save
version" click needed), and the lineage strip's "Diff" link opens
[Model Diff](./model-diff.md) pre-loaded with exactly that before/after
pair.

## Mesh tools: repair, smooth, decimate

The **Optimize** panel under a finished model, and the **Edit mesh** section
on every model page at `/m/<id>`, edit the mesh in your browser. Nothing is
uploaded: the GLB is read with glTF-Transform and the work runs in a Web
Worker, so the page stays responsive on a 500k-triangle model.

| Operation | What it does | Controls |
|---|---|---|
| Repair | Welds coincident vertices, removes collapsed, zero-area and duplicate faces, makes winding consistent across each shell, flips shells that face inward, and rebuilds normals with hard edges split at the crease angle. | Crease angle (0 to 180 degrees, default 60) |
| Smooth | Taubin (volume-preserving, the default) or plain Laplacian smoothing. Vertices that share a position move together, so UV seams never tear, and UVs, textures and materials are untouched. Open borders can be pinned. | Method, iterations (1 to 50), strength lambda (0.05 to 1), keep open borders fixed |
| Decimate | meshoptimizer simplification to a target, preserving UV seams first and relaxing them only if the budget cannot otherwise be reached. | Keep percentage or an exact target triangle count, with a live "before to after" preview |

Every edit reports what it did in numbers (vertices welded, faces re-wound,
points moved, shape error) and the before and after triangle count. Edits
stack: each one starts from the previous result, the breadcrumb shows the
chain, **Undo** (or Ctrl+Z inside the panel) steps back one edit, and
**Reset to original** returns to the stored model. The viewer and the
Download button follow the edited mesh, and **Download GLB** in the panel
saves it with the edit chain in the filename.

Browser formats (GLB, OBJ, STL, PLY, USDZ) export the edited mesh. Server
work (quad remesh, low-poly, FBX and 3MF conversion, and the slicer files
below) starts from the saved model, because the edit only exists in your
browser; the format menu says so instead of silently converting the original.

## Open in a 3D-printing slicer

The format menu's **Open in OrcaSlicer** and **Open in Bambu Studio** rows,
and the **3D print** action on a model page, send a saved model straight to a
slicer. The slicer downloads a print-ready file from
`/api/slicer/<id>/model.stl` (or `/<N>mm/model.3mf`): Z-up, in millimetres,
resting on the bed and centred on the plate. A model whose real size is 10 to
250 mm keeps it; anything else arrives with a 100 mm longest edge, and the
model page's size picker (50 to 200 mm) asks for an exact size. The full
route contract is in [api-reference.md](api-reference.md#slicer-file-get-apisliceridmodelstl).

| Slicer | How it opens | Notes |
|---|---|---|
| OrcaSlicer | `orcaslicer://open?file=<url>` | Opens the file directly. |
| Bambu Studio | `bambustudio://open?file=<url>` | Asks you to trust three.ws the first time. |
| PrusaSlicer | Download STL, then File > Import | Its `prusaslicer://` handler only accepts Printables and Thingiverse links, so there is no direct button. |

If nothing happens after a click (the slicer is not installed, or the browser
blocked the handler), the panel says so and offers the install page plus
**Download STL** and **Download 3MF** links, which work with every slicer.
The slicer rows appear once the model is saved, and they always send the
saved model: mesh tool edits are local, so after an edit the row reports
"sent (saved model, not your edits)". To print an edit, download it as STL
from the format menu and import it into the slicer by hand.

```bash
# The same file the slicer receives, at a 120 mm longest edge.
curl -sLo model.stl https://three.ws/api/slicer/<id>/120mm/model.stl
```

## Get it printed: live prices from Craftcloud

The format menu's **🖨 Get it printed** row, and the **Get it printed** action
on a model page, are a different flow from Materialize (three.ws's own print
pipeline, documented in [materialize.md](materialize.md)). Here, the model is
uploaded straight to [Craftcloud](https://craftcloud3d.com) (All3DP), priced
live across whichever of its roughly 186 print shops can run the job, and the
buyer pays Craftcloud directly on Craftcloud's own site. three.ws never takes
payment or touches the order.

`POST /api/print/craftcloud-quote` with `{ "creationId": "<uuid>" }` or
`{ "glbUrl": "<url>" }` converts the model to STL, uploads it to Craftcloud,
polls its pricing engine, and returns every (shop, material) quote it got
back, cheapest first, with shipping attached. Craftcloud's public v5 API has
no endpoint that hands a server-created cart back to a browser for checkout,
so the response carries `checkoutUrl: null` and an `uploadPageUrl` instead:
the honest next step is Craftcloud's own upload page, where pasting the same
file reproduces these prices in an authenticated session that can actually
check out. The adapter behind this lives at
`api/_lib/print/adapters/craftcloud.js`.

## Examples

Forge's read and generate surface is plain HTTP. No key is required for the free lanes.

```bash
# Read the tier/backend/cost matrix the UI renders.
curl 'https://three.ws/api/forge?catalog=1'

# Probe live backend health (which lanes are up right now).
curl 'https://three.ws/api/forge?health=1'

# Start a free text-to-3D generation. A lane that finishes inside the request
# (and any cache hit) answers with status "done", a glb_url, and a null job_id;
# slower lanes answer with a job_id to poll instead.
RESP=$(curl -s -X POST 'https://three.ws/api/forge' \
  -H 'content-type: application/json' \
  -d '{"prompt":"a weathered brass diving helmet","tier":"draft"}')
echo "$RESP" | python3 -c 'import sys,json;j=json.load(sys.stdin);print(j.get("glb_url") or j["job_id"])'

# If you got a job_id, poll it until the status is "done" or "failed".
curl "https://three.ws/api/forge?job=<JOB_ID>"
```

Image-to-3D over the API sends public image URLs instead of a prompt:

```bash
curl -X POST 'https://three.ws/api/forge' \
  -H 'content-type: application/json' \
  -d '{"image_urls":["https://…/front.jpg","https://…/side.jpg"],"tier":"standard"}'
```

Pin the Pixal3D fidelity lane (1 to 4 photos, pixel-aligned to every one of
them) with `backend`, and optionally label each photo's angle with
`view_labels` (`"front"`, `"back"`, `"left"`, `"right"`, same order as
`image_urls`) so the worker doesn't have to guess:

```bash
curl -X POST 'https://three.ws/api/forge' \
  -H 'content-type: application/json' \
  -d '{
    "image_urls": ["https://…/front.jpg","https://…/back.jpg","https://…/left.jpg"],
    "view_labels": ["front","back","left"],
    "backend": "pixal3d",
    "tier": "standard"
  }'
```

With exactly one photo, add `"fill_other_sides": true` to synthesize the
other three angles with MV-Adapter before reconstructing, instead of
reconstructing from the single view alone:

```bash
curl -X POST 'https://three.ws/api/forge' \
  -H 'content-type: application/json' \
  -d '{"image_urls":["https://…/front.jpg"],"fill_other_sides":true,"backend":"pixal3d","tier":"standard"}'
```

Pin the AniGen rig-on-generation lane with `backend`; the done response
carries `rigged: true` and `joint_count` alongside `glb_url`, so the result
needs no separate `/api/forge-rig` call:

```bash
curl -X POST 'https://three.ws/api/forge' \
  -H 'content-type: application/json' \
  -d '{"image_urls":["https://…/front.jpg"],"backend":"anigen","tier":"standard"}'
```

Pin the PartCrafter editable-parts lane with `backend`; the done response
carries `parts`, `part_count` and `parts_manifest_url` alongside `glb_url`,
and Restyle Studio's part picker reads that manifest directly:

```bash
curl -X POST 'https://three.ws/api/forge' \
  -H 'content-type: application/json' \
  -d '{"image_urls":["https://…/front.jpg"],"backend":"partcrafter","tier":"standard"}'
```

A minimal poll-until-done loop in JavaScript:

```javascript
const start = await fetch('https://three.ws/api/forge', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'a low-poly campfire', tier: 'draft' }),
}).then((r) => r.json());

let job = start;
while (job.status !== 'done' && job.status !== 'failed') {
  await new Promise((r) => setTimeout(r, 4000));
  job = await fetch(`https://three.ws/api/forge?job=${start.job_id}`).then((r) => r.json());
}
console.log(job.glb_url); // downloadable, textured GLB
```

## Generation controls

`POST /api/forge` and `POST /api/x402/forge` accept a handful of optional,
additive controls beyond `prompt`/`image_urls`/`tier`/`backend`. Every one is
off by default: a request that omits all of them behaves exactly as it did
before these existed.

| Field | Type | What it does |
|---|---|---|
| `target_polycount` (alias `target_faces`) | integer | Explicit geometry budget on poly-aware backends. Only honored by backends with `polyControl: true` in the engine catalog (`GET /api/forge?catalog=1`); others ignore it and the response says so. |
| `bbox` | `[x, y, z]` meters | The delivered mesh is uniformly rescaled to fit inside this box (aspect ratio preserved), centered on X/Z and floored at Y=0. Lane-agnostic: applied as a post-generation fit to the final GLB, so every backend honors it. |
| `pose` | `"t"` \| `"a"` | Requested rest pose for a humanoid/character subject. Only backends without a caller-supplied reference image can honor this (`poseControl: true`); a photo-conditioned lane reports `pose_applied: false` rather than silently ignoring the field. |
| `output_format` | `"glb"` \| `"glb-meshopt"` \| `"glb-draco"` | Compress the delivered GLB. |
| `texture_size` | integer (px) | Bake textures at a specific resolution instead of the tier default. |
| `seed` | integer | Reproducibility: the same seed, prompt and params reproduce the same mesh on backends that support it. |

```bash
# Target a 20k-triangle mesh, fit it into a 1.8m-tall box, and request a T-pose.
curl -X POST 'https://three.ws/api/forge' \
  -H 'content-type: application/json' \
  -d '{
    "prompt": "a low-poly adventurer",
    "tier": "standard",
    "target_faces": 20000,
    "bbox": [1.0, 1.8, 0.6],
    "pose": "t"
  }'
```

The done response's `options` object echoes what was actually requested
and, for `pose`, whether the chosen backend could honor it:

```json
{ "status": "done", "glb_url": "https://…/model.glb",
  "options": {
    "target_polycount": 20000, "target_faces": 20000,
    "bbox": [1.0, 1.8, 0.6], "pose": "t", "pose_applied": true
  } }
```

An invalid value (e.g. `pose: "sitting"`, or a non-positive `bbox` entry)
answers `400` naming the field rather than silently dropping it.

## Batch generation

**`POST /api/forge-batch`** fans one call out to up to 8 independent
`/api/forge` submissions and tracks them as a group, for building a set of
variations or a small asset pack without a client-side submit loop. Each
item is a full `/api/forge` body (any mix of prompts, images, tiers,
engines or the generation controls above); every item still runs through
`/api/forge`'s own gating and billing unchanged, so a batch never bypasses
the per-item tier rules.

```bash
curl -X POST 'https://three.ws/api/forge-batch' \
  -H 'content-type: application/json' \
  -d '{
    "items": [
      { "prompt": "a wooden crate", "tier": "draft" },
      { "prompt": "a steel crate, battle-damaged", "tier": "draft" },
      { "prompt": "a crystal crate, glowing", "tier": "draft" }
    ]
  }'
# → 200 { "batch_id": "...", "status": "queued",
#         "items": [{ "index": 0, "ok": true, "job_id": "...", "status": "queued" }, ...] }
```

Poll the group on the same batch id; each item carries its own status and,
once ready, its own `glb_url`:

```bash
curl 'https://three.ws/api/forge-batch?batch=<BATCH_ID>'
# → 200 { "batch_id": "...", "status": "done"|"partial"|"running"|"queued",
#         "items": [{ "index": 0, "ok": true, "status": "done", "glb_url": "..." }, ...] }
```

Group `status` is `"done"` only once every item succeeded; `"partial"` once
every item is terminal but at least one failed. One item's failure never
fails the batch: the response always carries every other item's own result,
with a structured `error`/`message` on the failed one. A batch group lives
for an hour; an expired or unknown `batch_id` answers `404 batch_not_found`
with a reminder that any job id already returned can still be polled
individually at `/api/forge?job=`.

The [Workbench](https://three.ws/workbench) exposes this as the **Batch**
drawer (toolbar icon, or press `B`): one prompt per line, up to 8, queued
with the Generate node's current engine, quality and controls.

## States and limits

- **Loading**: a real elapsed counter driven by the catalog ETA for the resolved path, tier, and engine. Cold self-host GPU workers add an honest spin-up estimate rather than a stalled bar.
- **Down lane**: disabled engine button with the real upstream reason; routing skips it via the circuit-breaker cooldown.
- **Storage outage**: when object storage rejects us, no engine can finish a generation (every lane has to park a reference image or a finished mesh), so switching engines is not offered. The page says plainly that the fault is ours, that nothing was charged, and points at what still works: every model you already forged is served from the public CDN and still opens, downloads and refines. Retry re-enables itself on a live countdown, because a repaired credential recovers without a redeploy.
- **Unconfigured backend**: a clean `backend_unconfigured` error, never a mock.
- **Resume**: an interrupted job is pollable again for 30 minutes from the same browser.
- **Every result** reports the path, tier, and backend that produced it, so you always know which engine ran.
- **The High tier is $THREE hold-or-pay gated** in the handler regardless of which free engine serves it: we charge for quality, not to recover vendor cost. A verified $THREE tier pass also lifts the free-lane quota.
- **BYOK engines** (Meshy, Tripo, Rodin, Stability, Replicate) require your own key; they are never billed to a platform account.
- **Photo input** accepts up to six views of one object (front, back, left, right, top, three-quarter); text-only engines are filtered out of the photo modes automatically.
- Rate limits are per client IP on the shared 3D generation buckets.

## Cost preview and pay-to-keep

`GET /api/forge-quote` is a public, no-spend preview of what a generation costs before you press Generate. Query: `path` (`text`, `image`, `multi`), `tier` (`draft`, `standard`, `high`), optional `backend`, `images`, `own_key`, `gameready`, or `table=1` for every tier at once. Every figure comes from the same tier and catalog code the generator charges from ([api/_lib/forge-tiers.js](../api/_lib/forge-tiers.js), [api/_lib/pricing/catalog.js](../api/_lib/pricing/catalog.js)), so the preview cannot drift from the bill. The `/forge` page shows it as a line under the estimate and refreshes it as you change tier, engine or options.

The response splits the cost into `generation` (free lane, your own key, or the High tier hold-or-pay gate), `keep` (the pay-to-keep step), the optional `gameready` export, and `total_usd`. Payments settle in $THREE on Solana.

**Pay-to-keep** is off by default, and while it is off nothing changes: every download is free exactly as before. When the owner turns it on, a Draft or Standard result is generated free and previewed, and the Download button first calls `POST /api/forge-keep` for that creation. $THREE holders keep for free, High results are already paid or held at generation time, and everyone else pays the `forge.keep.<tier>` price through the existing single-use consumption ledger (a payment can release one creation, once). `GET /api/forge-keep?id=<creation>` reports whether a creation is already kept. The keep step fails open on server faults so an outage never blocks a download. In this release the flag gates the Forge download flow, not the secrecy of the stored GLB URL on the CDN.

Enable or disable it with one command (it only updates the one env var, never the rest of the service env):

```
npm run forge:pay-to-keep -- status
npm run forge:pay-to-keep -- on
npm run forge:pay-to-keep -- off
```

Price points are derived from the tier prices (`forge.keep.draft` follows the Draft tier price, `forge.keep.standard` the Standard tier price) and are changed in the pricing catalog, not hardcoded in the UI.

## Measuring realism

Any change that could affect output quality (a tier's sampler budget, a new
lane, a prompt-enhancement change) should be checked against the realism
benchmark before and after: `node scripts/quality-bench.mjs` runs a fixed
23-prompt set through this real `/api/forge` path and scores the result with
Vertex Gemini vision; `node scripts/quality-bench.mjs --compare=latest,previous`
exits nonzero on a >1.0 mean-score drop. See
[data/quality-bench/README.md](../data/quality-bench/README.md) and the
dashboard at [/quality-bench](https://three.ws/quality-bench) (internal).

## Related

- [The Forge pipeline](./forge-pipeline.md) is the architecture deep dive: the engine grid, routing, failover, job lifecycle, workers, and payments, end to end. [How the Forge works](./how-forge-works.md) is the same story in plain language.
- [Image to 3D](./image-to-3d.md) is the photo lane opened directly at [/image-to-3d](https://three.ws/image-to-3d).
- [/forge-max](https://three.ws/forge-max) is the maximum-quality lane opened directly: the same Forge with the High tier pinned on arrival (200k-poly target, 4K PBR and HD textures, subject-aware engine routing). `?tier=draft|standard|high` presets the quality selector on any Forge URL the same way. The High tier's $THREE hold-or-pay gate applies unchanged; BYOK engines (your own Meshy, Tripo, or Rodin key) are exempt as always. For DamagedHelmet-class artist benchmarks, remember the ceiling is the current state of generative 3D, not the routing: this lane maxes every budget the engines expose, and [Measuring realism](#measuring-realism) is how we track that ceiling moving.
- [Diorama](./diorama.md) forges a whole scene of Forge objects into one explorable world.
- The 3D generation architecture: [3D pipeline](./3d-pipeline.md), [3D asset pipeline](./3d-asset-pipeline.md), [3D API](./3d-api.md).
- Pages: [/create](https://three.ws/create) (the avatar creator), [/scene](https://three.ws/scene) (Scene Studio), [/restyle](https://three.ws/restyle) (re-skin a GLB), [/gallery](https://three.ws/gallery).
