# texture — text-guided texturing & magic-brush region retexture

Paints materials onto meshes. One GPU model server hosts two capabilities that
together back the platform's post-generation texturing tools:

- **Full retexture** (`/texture`) — takes an untextured (or poorly-textured) GLB
  plus a text prompt, renders the mesh from 4 or 8 canonical viewpoints, generates
  coherent per-view textures with **SDXL + ControlNet-Depth**, rasterizes the mesh
  into UV space and back-projects each view through the camera it was rendered
  with (weighted by how squarely that view sees the texel, and refused outright
  where the depth buffer says something nearer hides it), fills what no view
  reached from the nearest neighbouring texel, and bakes a textured GLB.
- **Magic-brush region retexture** (`/retexture_region`) — repaints **only** a
  masked UV region of an existing texture from a prompt and/or a target colour,
  keeping the rest of the atlas bit-identical and feathering the seam so the edit
  is invisible. Runs real **SDXL inpainting** in UV space; safe to run repeatedly
  because each pass composites over the latest atlas through a feathered alpha, so
  there is no global quality drift.

Geometry comes from the generation lanes ([model-triposg](../model-triposg/),
[model-trellis](../model-trellis/), etc.); this worker is the *surface* stage that
turns bare geometry into a finished, material-clad GLB.

The viewer applies one more realism layer on top at load time, for free: any
GLB with recognizable skin/eye/hair mesh names gets its materials upgraded to
`MeshPhysicalMaterial` with measured-value skin sheen, wet-cornea clearcoat
eyes, and double-sided hair (`src/shared/avatar-material-realism.js`, wired
into `src/viewer.js`'s `setContent()`) — this runs regardless of which lane or
worker produced the mesh, so it is not a texture-worker concern, but it is the
other half of "the surface reads as real" this campaign targets.

## Status: built, not currently deployed

There is **no `texture-service` running in `aerial-vehicle-466722-p5`** (checked
in every region on 2026-08-11 and again on 2026-09-04: no Cloud Run service, no
Artifact Registry repo), and `three-ws-api` carries no `GCP_TEXTURE_URL`. Both
callers below therefore take their designed missing-lane path today: the HTTP
gateway answers `501 region_retex_unconfigured` (verified live against
three.ws on 2026-09-04) and the MCP tool raises a JSON-RPC error naming the two
env vars. Nothing is faked and no other lane is affected.

**Step 1 of "Bringing it up" is already done.** The checkpoints were staged on
2026-09-04: `gs://three-ws-model-weights/sdxl-texture` holds 15.7 GiB across
the four repos below, so a deploy no longer has to download SDXL inside the
first request. Only the two `gcloud` commands (build/deploy, then point the site
at the service) remain, and both need owner approval per the deploy gate in
CLAUDE.md. Re-check the staged tree with `gsutil du -s
gs://three-ws-model-weights/sdxl-texture`; re-check the service with:

```bash
gcloud run services list --project aerial-vehicle-466722-p5 --region us-central1 | grep texture
gcloud run services describe three-ws-api --region us-central1 \
  --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep TEXTURE
```

## How it runs

Cloud Run service **`texture-service`** in **`us-central1`**, built by Cloud
Build from [`cloudbuild.yaml`](./cloudbuild.yaml). It is a GPU service: 1x
`nvidia-l4`, 8 vCPU, 32 GiB, 600 s request timeout, `min-instances=0`,
`max-instances=2` (scale-to-zero, so the first request after idle pays a
one-time SDXL + ControlNet model load). CI/deploy is Cloud Build only; there are
no GitHub Actions.

Bringing it up is three commands, in this order:

```bash
# 1. stage the checkpoints (~15 GiB, once, and again on any checkpoint change).
#    Needs huggingface_hub and google-cloud-storage on the host, and credentials
#    the storage client can find (a service account, or gcloud application
#    default credentials). DONE on 2026-09-04; re-run only on a checkpoint change.
python3 workers/texture/stage_weights.py --prefix sdxl-texture

# 2. build + deploy from the repo root (the build step declares dir: workers/texture,
#    so the upload source is the whole repo)
gcloud builds submit --config workers/texture/cloudbuild.yaml . \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s)

# 3. point the site at it (--update-env-vars merges; --set-env-vars would wipe
#    every other var on the service)
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars=GCP_TEXTURE_URL=$(gcloud run services describe texture-service \
    --region us-central1 --format='value(status.url)')
```

Step 2 is also what `workers/deploy/deploy-editing.sh` runs, alongside the
bucket, secret and IAM setup, for a project that has never had these workers
(`texture` is a GPU extra there, so it needs L4 quota):

```bash
PROJECT_ID=<gcp-project> SERVICES="texture" workers/deploy/deploy-editing.sh
```

Skipping step 1 is the failure that reads as a hang rather than as a missing
file: with an empty weights prefix the loader falls back to the image cache,
which holds the depth ControlNet only, and the SDXL download it then issues from
inside the first request burns the whole 600 s timeout. The two weight sources,
in the order the loader tries them:

1. **`gs://three-ws-model-weights/sdxl-texture`** (`WEIGHTS_GCS_URI`), copied to
   local disk at `WEIGHTS_LOCAL_DIR` with the storage client on first load. Not
   a FUSE mount: nothing is mounted at `/weights` on this service, because a
   safetensors load stalls on the large sequential reads gcsfuse serves.
2. **`/opt/hf-cache`** (`WEIGHTS_DIR`), baked into the image by the
   [`Dockerfile`](./Dockerfile). ControlNet-Depth only.

Only the **fp16** variant of each checkpoint is ever loaded (`WEIGHT_VARIANT`),
which is what keeps the set at ~15 GiB against the ~44 GiB the full-precision
files would pull. The staged prefix and the image cache must both match it.

Output GLBs are written to `three-ws-avatar-reconstructions` under
`textured/<task_id>.glb`. See
[`docs/ops/gcp-model-workers.md`](../../docs/ops/gcp-model-workers.md) for the
lane-routing and operations runbook.

### Local

Serving needs a CUDA GPU and a GCS bucket for output:

```bash
cd workers/texture
pip install -r requirements.txt
API_KEY=dev GCS_BUCKET=your-dev-bucket WEIGHTS_DIR=/tmp/weights \
  uvicorn main:app --host 0.0.0.0 --port 8080
```

### Tests

The geometry that decides where a generated pixel lands on the surface lives in
[`texture_projection.py`](./texture_projection.py), kept free of torch and
pyrender so it runs anywhere, GPU or not:

```bash
cd workers/texture
python3 test_texture_projection.py   # camera, rasterizer, occlusion, blend
python3 test_gltf_meshopt.py         # the meshopt decode every caller mesh passes through
```

Both run as a Docker build gate, so a regression fails the image instead of
reaching a user mid-retexture.

## API

Async task shape. Every route except `/health` requires
`Authorization: Bearer $API_KEY`. Submit returns `202` with a `task_id`; poll
`GET /tasks/:id` until `status` is `done` (with `result_url`) or `failed` (with
`error`). Remote mesh and mask URLs are fetched through the SSRF guard in
[`worker_security.py`](./worker_security.py).

A mesh saved with `EXT_meshopt_compression` (what `gltfpack` emits, and what most
three.ws avatars ship as) is transcoded to plain glTF by
[`gltf_meshopt.py`](./gltf_meshopt.py) before loading: trimesh has no decoder for
that extension, so those meshes used to fail outright. The `gltfpack` binary is
pinned by release tag and checksum in the [`Dockerfile`](./Dockerfile); set
`GLTFPACK_BIN` to point at your own copy locally.

### `POST /texture` → `202`

```bash
curl -X POST https://$SERVICE_URL/texture \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{
    "mesh": "https://storage.googleapis.com/three-ws-avatar-reconstructions/mesh.glb",
    "prompt": "worn leather, dark brown, stitched seams",
    "num_views": 8,
    "texture_size": 2048
  }'
# → { "task_id": "…", "status": "queued" }
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `mesh` | yes | — | https URL to the input GLB |
| `prompt` | yes | — | 3–500 chars, texture description |
| `negative_prompt` | no | `blurry, low quality, distorted, watermark` | |
| `num_views` | no | `8` | `4` or `8` render viewpoints |
| `texture_size` | no | `2048` | `512`, `1024`, or `2048`. Drives the depth render, the per-view SDXL resolution and the baked atlas, so it costs real diffusion compute |
| `material_class` | no | — | `person`, `metal`, `wood`, `fabric`, `plastic`, or `glass` — bakes measured real-world roughness/metallic factors for that class instead of a flat guess, and appends material-appropriate descriptors to the SDXL prompt (see `MATERIAL_CLASS_PBR` in `main.py`) |

### `POST /retexture_region` → `202`

Repaints only the masked region. The mask is a UV-space PNG (white = repaint,
black = keep) — either inline base64 (from a browser canvas `toDataURL()`, a
`data:` prefix is tolerated) via `mask_b64`, **or** a public URL via `mask`. Pass
a `prompt` and/or a `color`.

```bash
curl -X POST https://$SERVICE_URL/retexture_region \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{
    "mesh": "https://storage.googleapis.com/three-ws-avatar-reconstructions/textured/abc.glb",
    "prompt": "cracked red enamel",
    "color": "#b02020",
    "mask_b64": "iVBORw0KGgo…",
    "strength": 0.85,
    "feather": 24
  }'
# → { "task_id": "…", "status": "queued" }
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `mesh` | yes | — | https URL to a textured GLB |
| `prompt` | prompt and/or color | `""` | ≤500 chars, what to paint into the region |
| `mask_b64` | mask_b64 or mask | — | UV mask PNG, base64 (white = edit) |
| `mask` | mask_b64 or mask | — | public https URL to the UV mask PNG |
| `color` | — | — | `"#rrggbb"` hint that primes the region hue |
| `negative_prompt` | no | `blurry, low quality, distorted, watermark, seam` | |
| `texture_size` | no | `2048` | `512`, `1024`, or `2048` working/output atlas. The inpaint itself always runs at SDXL-native 1024, so this costs compositing time only |
| `strength` | no | `0.85` | inpaint denoise strength, `0.2`–`1.0` |
| `feather` | no | `24` | seam feather radius in atlas px, `1`–`128` |
| `seed` | no | `0` | ≥0, reproducible output |

The inpaint pipeline is loaded lazily on the first region request, so the
`/texture` path pays no extra startup cost or VRAM until a magic-brush edit runs.

### `GET /tasks/{task_id}`

```json
{
  "task_id": "…",
  "status": "done",
  "result_url": "https://storage.googleapis.com/three-ws-avatar-reconstructions/textured/….glb",
  "bytes": 4185302,
  "elapsed_ms": 41230
}
```

`status` is one of `queued`, `running`, `done`, `failed`. On failure the object
carries a sanitized `error` string instead of `result_url`.

### `GET /health`

```json
{ "ok": true, "service": "texture", "gpu_available": true, "model_loaded": true, "inpaint_loaded": false }
```

## Env

| Var | Required | Default | Notes |
|---|---|---|---|
| `API_KEY` | yes | — | Shared bearer secret (Secret Manager: `avatar-reconstruction-key`) |
| `GCS_BUCKET` | yes | — | Output bucket (`three-ws-avatar-reconstructions`) |
| `WEIGHTS_DIR` | no | `/weights` | Fallback weight cache, used when GCS staging is off or the prefix is empty. Cloud Run sets it to `/opt/hf-cache`, the cache baked into the image; no volume is mounted |
| `WEIGHTS_GCS_URI` | no | (unset) | `gs://` prefix holding the HuggingFace cache tree. Cloud Run sets `gs://three-ws-model-weights/sdxl-texture`; populate it with `stage_weights.py` |
| `WEIGHTS_LOCAL_DIR` | no | `/tmp/sdxl-texture` | Where the staged copy lands on the instance |
| `WEIGHT_VARIANT` | no | `fp16` | Checkpoint variant resolved from every repo. Must match what was staged |
| `SDXL_MODEL` | no | `stabilityai/stable-diffusion-xl-base-1.0` | Base SDXL checkpoint |
| `CONTROLNET_MODEL` | no | `diffusers/controlnet-depth-sdxl-1.0` | Depth ControlNet for full retexture |
| `SDXL_INPAINT_MODEL` | no | `diffusers/stable-diffusion-xl-1.0-inpainting-0.1` | Magic-brush inpainting checkpoint |
| `MAX_CONCURRENT` | no | `1` | One L4 fits one inference at a time |

## Callers

Routed through `api/_providers/gcp.js`, which reads **`GCP_TEXTURE_URL`** (the
worker base URL) and **`GCP_RECONSTRUCTION_KEY`** (the shared bearer secret,
Secret Manager `avatar-reconstruction-key`). Both the `retex` (full) and
`retex_region` (magic brush) modes resolve to this one service:

- **MCP `retexture_model`** (`api/_mcp3d/tools/studio.js`) → mode `retex` →
  `POST /texture`.
- **MCP `retexture_region`** and the HTTP gateway
  **`POST /api/studio/retexture-region`** (`api/studio/retexture-region.js`) →
  mode `retex_region` → `POST /retexture_region`. The gateway is the thin,
  authenticated, SSRF-guarded front door: it packs the worker task handle into an
  opaque `job` token and re-validates that token targets the configured worker
  before polling, so a forged token can never steer the server's fetch. Submitting
  spends the `upload` quota; polling spends the shared status-poll quota, so a
  runaway poll loop cannot hammer the worker.

If `GCP_TEXTURE_URL` (or the key) is unset, both callers fail closed with the
message above: the lane drops out and nothing is faked. The gateway answers
`501 region_retex_unconfigured` on **both** verbs in that case, including a poll
carrying a job token issued while the lane was up, so an unconfigured deployment
never reports a legitimate token as malformed. Production env vars for
`three.ws` live on the `three-ws-api` Cloud Run service (`gcloud run services
describe three-ws-api --region us-central1`), not in a `.env` file.

## PBR channel matrix (what each lane actually emits)

A mesh can be geometrically perfect and still read as plastic, because a glTF
material carrying only a baseColor atlas has no normal map, no
roughness/metallic map and no ambient occlusion: a knife blade, a wool sweater
and a pane of glass then all reflect the viewer's IBL identically. This table is
the measured state of that gap, not an estimate. Reproduce it with:

```bash
# one real generation per lane through the live router, then:
node scripts/inspect-glb-materials.mjs --matrix \
  --label=trellis_selfhost <glb-url> \
  --label=hunyuan3d <glb-url>
```

`scripts/inspect-glb-materials.mjs` prints, per material, which of the five glTF
metallic-roughness texture slots exist and at what resolution, decoding each
image header rather than trusting a declared size. It exits `1` when any model is
missing a channel its own materials imply it should carry, so it doubles as a
regression gate.

Measured 2026-09-04 against `/api/forge`, prompt "a worn brown leather armchair
with brass studs", tier `standard`:

| Lane | baseColor | normal | metallicRoughness | occlusion | emissive |
| --- | --- | --- | --- | --- | --- |
| `trellis_selfhost` | 2048x2048 | no | no | no | no |
| `hunyuan3d` | 2048x2048 | no | 2048x2048 | no | no |
| `triposg` (sketch path) | untextured by design | no | no | no | no |

Two consequences are worth stating plainly, because both are invisible until the
model is lit:

- Every lane ships `metallicFactor 1.0` and `roughnessFactor 1.0`. On
  `trellis_selfhost`, which emits no metallicRoughness texture at all, there is
  nothing to modulate those factors, so a leather armchair renders as fully
  metallic, fully rough bare metal.
- Hunyuan3D declares `image/png` on texture bytes that are actually JPEG.

`api/_lib/glb-pbr-derive.js` closes both gaps in one pass, filling only what is
absent so a lane that starts emitting real normals is never overwritten by an
estimate. Measured on the same two generations:

| Lane | derived | in | out | wall clock |
| --- | --- | --- | --- | --- |
| `trellis_selfhost` | normal, metallicRoughness, occlusion, sheen | 3791 KiB | 5306 KiB | 5.4 s |
| `hunyuan3d` | normal, occlusion, sheen (mime corrected to JPEG) | 3006 KiB | 4234 KiB | 3.5 s |

Both re-inspect clean: `All 2 model(s) carry a complete PBR set.` Derived map
size follows the tier (`TIER_DERIVED_SIZE`: draft 1024, standard 2048, high
4096); the packed occlusion/roughness/metallic texture is written at half that,
which is standard practice for a low-frequency channel and is why the table above
shows a 1024 ORM beside a 2048 normal at the standard tier.

## Payload: what a complete 4K PBR set costs on a phone

Completing the material set is not free, and the bill lands on the slowest
device that will ever open the model. `scripts/glb-mobile-payload.mjs` measures
that bill end to end on a real asset: it runs the real derive pass, then the real
compression chain (`scripts/compress-glbs.mjs`), then loads the finished GLB in
the shipped `/avatar-embed` page under WebKit and under Android Chrome
emulation, throttled to the Lighthouse mobile profile (1.6 Mbps, 150 ms RTT, 4x
CPU). "Rendered" means a mesh from the model is live in the scene graph, not that
a request returned 200, and the transfer figure is CDP `encodedDataLength`, not a
content-length guess.

```bash
npm run dev
npm run check:glb:payload -- --tier=high public/avatars/dancing-twerk.glb
npm run check:glb:payload -- --tier=high --max-texture=2048 public/avatars/dancing-twerk.glb
```

`--max-texture=<px>` is the tiered-delivery lever, and it lives in
`compress-glbs.mjs` as one more option on the chain that is already there rather
than a second encoder: it caps every texture's longest edge through
`textureCompress`'s own resize step, so the viewer's copy and the full-res
download come out of one code path.

The measured cost of the high tier is the reason that lever exists. Measured
2026-09-08 on `public/avatars/dancing-twerk.glb`, a real 4096-textured avatar,
derived at `--tier=high`:

| Delivery | compressed GLB | WebKit (iPhone 13) | Android Chrome (Pixel 5), slow 4G + 4x CPU |
| --- | --- | --- | --- |
| full 4K | 10633 KiB | rendered | rendered, 10633 KiB over the wire, 218969 ms |
| capped at 2048px | 6309 KiB | rendered | rendered, 6309 KiB over the wire, 205207 ms |

The input was 3505 KiB; the derive pass takes it to 12114 KiB before compression,
because a complete set is three maps where there was one. Every leg rendered, so
nothing here is a hard failure. Two things in that table are worth reading
carefully.

The first is the 219 seconds. A complete 4K set is a DOWNLOAD format, not a
viewer format, and a phone should be served the capped copy. That is not a new
endpoint to build, it is
`/api/avatar/optimize?src=...&textureSize=1024` (or 2048), which the embed page
already routes through when a `textureSize`, `lod`, `morphs` or `draco` parameter
is present (`optimizedUrl()` in `src/avatar-embed.js`), and whose own ceiling is
2048 by construction. The raw GLB URL stays the full-res download.

The second is that halving the payload barely moved the clock: 41% fewer bytes
bought 6% less time. So on this harness the wall clock is not network-bound at
all, it is bound by SwiftShader decoding textures and rasterizing a skinned mesh
under a 4x CPU throttle, and a real phone with a real GPU will not reproduce
these seconds. Treat the transfer column as the honest, portable number (it is
CDP `encodedDataLength`, so it is what a real device would actually download) and
the millisecond column as a ceiling measured on the slowest renderer available,
useful for catching a regression against itself rather than as a field budget.
The same caveat applies doubly to the WebKit timings, which additionally have no
network throttling available through Playwright: read those as "it opens".

The practical consequence is that texture size is the lever for bytes, and the
lever for time is somewhere else (mesh complexity, texture COUNT, and the decode
format). That is worth knowing before anyone spends a week tuning resolutions to
fix a load time.

## Reproducing the avatar material readback

`workers/texture` finishes the material on a generated mesh. The viewer finishes
it again at load time for avatars specifically, where skin, eyes and hair each
need a different physical answer than a generic dielectric
(`src/shared/avatar-material-realism.js`). `scripts/avatar-realism-shots.mjs`
proves that pass ran, rather than assuming it:

```bash
npm run dev
npm run shots:avatar-realism
```

It screenshots the avatar at 320, 768 and 1440 px and writes
`docs/assets/avatar-realism/avatar-realism-readback.json`, which records the
physical values that actually landed per class. On
`/avatars/realistic-male.glb` that is 6 classified meshes at every breakpoint:
both eyes physical with clearcoat 1 and IOR 1.376, both skin meshes at roughness
0.6 with sheen 0.35 and specular 0.6, hair at 0.55 with sheen 0.5, teeth at 0.25.
The script exits nonzero when no skin or eye material was upgraded.

It loads `/avatar-embed`, NOT `/viewer`. Those are different pages: `/viewer`
hands the model to `<model-viewer>`, which brings its own three.js and never runs
this pass, and it rejects any `?src=` that is not an absolute https URL. A
readback taken there reports zero meshes no matter what the pass does.
