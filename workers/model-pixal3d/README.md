# model-pixal3d: 1 to 4 photos to PBR 3D asset, pixel-aligned (Pixal3D)

FastAPI inference service that turns **one to four photos of the same subject
into a PBR-textured GLB** with [TencentARC
Pixal3D](https://github.com/TencentARC/Pixal3D) (pixel-aligned image-to-3D,
MIT license, built on [Microsoft
TRELLIS.2](https://github.com/microsoft/TRELLIS.2)'s backbone). It is the
Forge's fidelity lane, labeled **"Match my photo"**: where `model-trellis2`
and `model-hunyuan3d` generate a plausible asset from one view,
`model-pixal3d` pixel-aligns the result to every photo it is given, and more
photos narrow the result further.

What a caller gets back:

- A glTF binary with base colour, metallic-roughness and normal maps, same
  bake pipeline as `model-trellis2`: `o_voxel` postprocess, alpha-aware
  `BLEND`/`OPAQUE` material choice, meshopt compression through the pinned
  `gltfpack` binary.
- Two resolutions: `1024` (default, draft/standard tiers) and `1536`
  (maximum detail, cascaded, high/max tiers).
- **1 to 4 input images.** One photo runs the single-view path (Pixal3D's own
  MoGe-2 camera estimation recovers the shot's camera from the photo itself).
  Two to four photos run the multi-view path: an optional `view_labels` entry
  per image (`"front"`, `"back"`, `"left"`, `"right"`) places it at that
  azimuth around one shared, MoGe-2-estimated camera; an unlabeled slot
  spreads evenly among the azimuths no label claimed. Exactly one photo with
  `fill_other_sides: true` first synthesizes the other three azimuths with
  MV-Adapter (`mv_adapter_fill.py`), then runs the same multi-view path on all
  four, trading a slower request for a result informed by more than one real
  view.

Work is asynchronous: `POST /infer` returns `202` with a `task_id`, and the
caller polls `GET /tasks/{id}` until `status` is `done`. With `GCS_BUCKET` set
the GLB lands at
`gs://$GCS_BUCKET/raw-meshes/pixal3d/{task_id}.glb` and is returned as a
`storage.googleapis.com` URL. Without it the container writes tasks and
results under `OUTPUT_DIR` and serves the mesh from `GET /results/{id}.glb`.

## Endpoints

`POST /infer`, `GET /tasks/{id}` and `GET /results/{id}.glb` require
`Authorization: Bearer $API_KEY`. `GET /health` and `GET /` are
unauthenticated: they carry no secrets, and the platform reads them to decide
whether the lane can take work.

### `POST /infer`

```json
{
  "images": [
    "https://example.com/front.png",
    "https://example.com/back.png"
  ],
  "view_labels": ["front", "back"],
  "fill_other_sides": false,
  "resolution": 1536,
  "tier": "high",
  "seed": 42,
  "texture_size": 4096,
  "decimation_target": 1000000,
  "job_id": "optional-caller-id"
}
```

| Field | Meaning |
|---|---|
| `images` | 1 to 4 `https://` URLs or `data:` URIs, same subject, any order. URLs are SSRF-checked (no private or link-local hosts). |
| `view_labels` | Optional, one entry per image: `"front"`, `"back"`, `"left"`, `"right"`, or `null`. Omitted or shorter than `images` means every slot spreads evenly. A length mismatch is a `400`. |
| `fill_other_sides` | Only valid with exactly one image (otherwise `400`): synthesize the other three azimuths with MV-Adapter before reconstructing. |
| `resolution` | `1024` or `1536`. Anything else is a `422`. Wins over `tier`. |
| `tier` | `draft`/`standard` (1024), `high`/`max` (1536). Used only when `resolution` is absent. |
| `seed` | Reproducible sampling. |
| `texture_size`, `decimation_target` | Bake overrides, clamped to 512-4096 (power of two) and 50k-2M faces. |

### `GET /tasks/{id}`

```json
{
  "task_id": "…",
  "status": "done",
  "result_gcs_url": "https://storage.googleapis.com/…/raw-meshes/pixal3d/….glb",
  "resolution": 1536,
  "resolution_served": 1536,
  "views_used": 2,
  "alpha_mode": "OPAQUE",
  "packed": true
}
```

A request the GPU cannot hold is retried one size down (1536 to 1024) and
`resolution_served` reports the step so the platform never reports a
stepped-down result as the requested one. `status` is one of `queued`,
`running`, `done`, `failed`.

## Run it and call it

```bash
# Build and run on a machine with an NVIDIA GPU (24 GB or more).
docker build -t model-pixal3d workers/model-pixal3d
docker run --gpus all -p 8080:8080 \
  -e API_KEY=dev-secret -e OUTPUT_DIR=/data \
  -e WEIGHTS_GCS_URI=gs://three-ws-model-weights/pixal3d \
  -v "$PWD/data:/data" model-pixal3d

# Submit and poll a 2-photo request.
TASK=$(curl -s -X POST localhost:8080/infer \
  -H "Authorization: Bearer dev-secret" -H "content-type: application/json" \
  -d '{"images":["https://example.com/front.png","https://example.com/back.png"],
       "view_labels":["front","back"],"resolution":1536}' | jq -r .task_id)
curl -s localhost:8080/tasks/$TASK -H "Authorization: Bearer dev-secret"
```

Through the platform the same lane is reached with `POST /api/forge` using
`{"path":"image","backend":"pixal3d","images":[...],"view_labels":[...]}`, or
from the Forge UI's "Match my photo" drop zone (1 to 4 images, optional view
labels per slot). The catalog (`GET /api/forge?catalog`) lists the accepted
`resolutions` on the `pixal3d` backend.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `API_KEY` | none | Shared bearer secret (Secret Manager `avatar-reconstruction-key` on Cloud Run). |
| `GCS_BUCKET` | unset | Output bucket. Unset uses `OUTPUT_DIR`. |
| `OUTPUT_DIR` | `/output` | Task and result volume for standalone use. |
| `WEIGHTS_DIR` | `/weights/pixal3d` | Local weight tree (gcsfuse mount on Cloud Run). |
| `WEIGHTS_GCS_URI` | unset | `gs://` tree. Each sub-model streams to local disk, loads, then is deleted, so peak disk is one checkpoint. The full set (about 46 GiB across both pipelines) does not fit Cloud Run's in-memory filesystem otherwise. |
| `WEIGHTS_LOCAL_DIR` | `/tmp/pixal3d-weights` | Scratch for that streaming. |
| `MVADAPTER_WEIGHTS_DIR` | `/weights/mvadapter` | Local staged copy of the SDXL base, VAE and adapter weights `fill_other_sides` needs. Falls back to the Hub id per model when a sub-directory is missing, which fails under `HF_HUB_OFFLINE=1` until staged (see `stage_weights.sh`). |
| `PIXAL3D_SRC` | `/opt/pixal3d-src` | Vendored Pixal3D checkout; `main.py` imports its `inference.py`/`inference_mv.py` reference scripts directly rather than reimplementing them. |
| `MVADAPTER_SRC` | `/opt/mvadapter-src` | Vendored MV-Adapter checkout, same reasoning. |
| `LOW_VRAM` | `1` | Moves each stage's weights to the GPU only while it runs. A single L4 cannot hold the single-view pipeline, the multi-view pipeline and MV-Adapter resident at once; see "Known limits" below. |
| `MAX_RESOLUTION` | `1536` | Ceiling on the served resolution. |
| `MAX_CONCURRENT` | `1` | Parallel inferences per instance. One GPU, so instance count is the concurrent-generation count. |
| `IMAGE_FETCH_TIMEOUT_S` | `30` | Per-attempt image fetch timeout. |
| `MODEL_LOAD_ATTEMPTS` | `4` | Weight-staging attempts before the error latches and `/health` returns 503. |
| `MODEL_LOAD_RETRY_BASE_S`, `MODEL_LOAD_RETRY_CAP_S` | see `main.py` | Load-retry backoff bounds. |

The platform side reads `MODEL_PIXAL3D_URL` (this service's URL) and
`GCP_RECONSTRUCTION_KEY` (the bearer secret) from the `three-ws-api`
environment. Until `MODEL_PIXAL3D_URL` is set the lane reports unconfigured
and Forge's "Match my photo" option stays hidden; the default single-image
lanes keep working unaffected.

## Files

| File | Role |
|---|---|
| `main.py` | FastAPI app, streaming weight loader, task store, GPU executor, single-view and multi-view generation. |
| `camera_rig.py` | Turns view labels into azimuths and camera transform matrices when no real camera data exists. Pure logic, unit tested (`test_camera_rig.py`). |
| `mv_adapter_fill.py` | The `fill_other_sides` rung: wraps MV-Adapter's own `prepare_pipeline`/`run_pipeline` reference functions. |
| `request_policy.py` | Resolution presets, tier mapping, bake clamps, fetch-retry policy. Pure logic. |
| `pipeline_config.py` | Rewrites upstream's `pipeline.json`/`pipeline_mv.json` to the licence-clean model set below. |
| `glb_pack.py` | Alpha-mode decision and meshopt packing through `gltfpack`. |
| `stage_weights.sh` | One-time mirror of every upstream weight into `gs://three-ws-model-weights/pixal3d` and `.../pixal3d-mvadapter`. |
| `worker_security.py`, `instance_health.py`, `storage_backend.py` | Vendored shared modules, kept byte-identical by `npm run check:vendored`. |
| `Dockerfile`, `cloudbuild.yaml` | CUDA 12.4 image with the compiled extensions, and the Cloud Build deploy. |
| `test_*.py` | Unit and contract tests. They also run as the build-time gate inside the Dockerfile. |

## Deploy

GPU worker deploys are owner-gated. The image build compiles the same CUDA
extensions `model-trellis2` does plus `natten`, and takes most of an hour on
the 32-vCPU builder; the config pins the `three-ws-build@` service account.

```bash
# 1. One time: mirror the weights (idempotent, skips what is already there).
workers/model-pixal3d/stage_weights.sh

# 2. Build, push and deploy.
gcloud builds submit --config workers/model-pixal3d/cloudbuild.yaml \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s) .

# 3. Point the API at it.
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars MODEL_PIXAL3D_URL=$(gcloud run services describe model-pixal3d \
  --region us-central1 --format='value(status.url)')
```

The service runs on one NVIDIA L4 (24 GB) with minimum instances `0`. The
us-central1 L4 grant is shared by every GPU lane, so a warm floor here is a
quota decision: the first request after idle pays the weight stream and
pipeline load, and the keep-warm cron does not warm this lane by default.
Raise the floor with `gcloud run services update model-pixal3d
--min-instances=1` when quota allows.

## Licence notes

Pixal3D is MIT. The same two upstream swaps `model-trellis2` already made are
carried over, since Pixal3D's reference scripts hardcode the same two
non-local dependencies:

- **Background removal: BiRefNet (MIT) instead of RMBG-2.0.** RMBG-2.0 is
  CC BY-NC 4.0, which forbids commercial use.
- **Image conditioner: DINOv3 ViT-L/16 from an ungated mirror**
  (`camenduru/dinov3-vitl16-pretrain-lvd1689m`). The official `facebook/` repo
  is gated and the platform's Hugging Face token is refused on it.

`pipeline_config.py` applies both swaps by rewriting `pipeline.json` and
`pipeline_mv.json` at load time; `main.py` additionally patches
`inference.py`'s and `inference_mv.py`'s own hardcoded `IMAGE_COND_CONFIGS`
dict to the same local copy, since those scripts rebuild their four per-stage
conditioners from that dict rather than from the pipeline config's own key.

**MV-Adapter** (the optional `fill_other_sides` rung) is Apache-2.0, as are
its published adapter weights. Its SDXL base,
`stabilityai/stable-diffusion-xl-base-1.0`, is CreativeML Open RAIL++-M, which
permits commercial hosting.

**Open licence risk, owner decision, inherited from TRELLIS.2:**
`nvdiffrast`. See [`../model-trellis2/README.md`](../model-trellis2/README.md)'s
identical note: NVIDIA's rasteriser carries the NVIDIA Source Code License
(1-Way Commercial), which this worker does not widen but also does not
remove.

Known limits:

- `1536` on a 24 GB L4 is the tightest setting and is unverified until the
  first deployed generation. The worker steps down on out-of-memory and
  reports `resolution_served`.
- `LOW_VRAM=1` keeps each stage's weights off the GPU except while it runs,
  but a single instance that serves a single-view request and then a
  multi-view request over its lifetime can still end up holding both
  pipelines' Python objects (not their GPU tensors) resident. If live traffic
  shows VRAM contention between request shapes, split the lane into two
  Cloud Run services behind separate `MODEL_PIXAL3D_URL`-style env vars, one
  per request shape, rather than trying to share an instance.
- The exact sampler hyperparameters `mv_adapter_fill.py` uses
  (`NUM_INFERENCE_STEPS`, `GUIDANCE_SCALE`) are upstream's own script defaults
  and have not been tuned against a live GPU; treat them as a starting point.

Related: [`../model-trellis2/README.md`](../model-trellis2/README.md) (the
default, non-fidelity lane), [`../../docs/forge-pipeline.md`](../../docs/forge-pipeline.md),
[`../../docs/ops/gcp-model-workers.md`](../../docs/ops/gcp-model-workers.md).
