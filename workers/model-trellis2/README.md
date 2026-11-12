# model-trellis2: single image to PBR 3D asset (TRELLIS.2)

FastAPI inference service that turns **one image into a PBR-textured GLB** with
[Microsoft TRELLIS.2](https://github.com/microsoft/TRELLIS.2) (4B flow
transformer over O-Voxel structured latents, MIT license). It is the default
image-to-3D lane of the Forge (`/forge`, `/api/forge`) and the only default lane
that serves the European Union, the United Kingdom and South Korea, where the
Tencent Hunyuan3D license does not apply (see
[`../model-hunyuan3d/README.md`](../model-hunyuan3d/README.md) and
`api/_lib/forge-territory.js`).

What a caller gets back:

- A glTF binary with base colour, metallic-roughness and normal maps.
- **Alpha preserved.** `o_voxel` bakes opacity into the base colour alpha channel
  but declares the material opaque. `glb_pack.py` flips the material to `BLEND`
  when enough of the texture is genuinely translucent and leaves it `OPAQUE`
  otherwise, so glass and foliage render correctly without haloing solid assets.
- **Meshopt compression** through the pinned `gltfpack` binary (v1.2, checksum
  verified in the Dockerfile). Quantisation is on, texture compression is off, so
  the baked PBR maps and alpha stay byte-exact.
- Three resolutions: `512` (latency lane), `1024` (default), `1536` (maximum
  detail, cascaded).

Work is asynchronous: `POST /infer` returns `202` with a `task_id`, and the caller
polls `GET /tasks/{id}` until `status` is `completed`. With `GCS_BUCKET` set the
GLB lands at `gs://$GCS_BUCKET/raw-meshes/trellis2/{task_id}.glb` and is returned
as a `storage.googleapis.com` URL. Without it the container writes tasks and
results under `OUTPUT_DIR` and serves the mesh from `GET /results/{id}.glb`.

## Endpoints

`POST /infer`, `GET /tasks/{id}` and `GET /results/{id}.glb` require
`Authorization: Bearer $API_KEY`. `GET /health` and `GET /` are unauthenticated:
they carry no secrets, and the platform reads them to decide whether the lane can
take work.

### `POST /infer`

```json
{
  "images": ["https://example.com/front.png"],
  "resolution": 1024,
  "tier": "standard",
  "seed": 42,
  "texture_size": 4096,
  "decimation_target": 1000000,
  "job_id": "optional-caller-id"
}
```

| Field | Meaning |
|---|---|
| `images` | One or more `https://` URLs or `data:` URIs. TRELLIS.2 conditions on one image, so the first is used and the task reports `views_used: 1`. URLs are SSRF-checked (no private or link-local hosts). |
| `resolution` | `512`, `1024` or `1536`. Anything else is a `422`. Wins over `tier`. |
| `tier` | `draft` (512), `standard` and `high` (1024), `max` (1536). Used only when `resolution` is absent, so forge tiers and explicit resolutions land on the same presets. |
| `seed` | Reproducible sampling. |
| `texture_size`, `decimation_target` | Bake overrides, clamped to 512 to 4096 (power of two) and 50k to 2M faces. |
| `sampler` | Per-stage flow sampler overrides: `{"sparse_structure"|"shape_slat"|"tex_slat": {"steps", "guidance_strength"}}`. Steps clamp to 1 to 50, guidance to 0 to 15; unknown stages, keys and unparseable values are dropped. Omitted fields keep the upstream `pipeline.json` defaults (12 steps per stage; guidance 7.5, 7.5, 1.0), which `GET /health` publishes as `sampler_defaults`. |

### `GET /tasks/{id}`

```json
{
  "task_id": "…",
  "status": "completed",
  "result_gcs_url": "https://storage.googleapis.com/…/raw-meshes/trellis2/….glb",
  "resolution": 1024,
  "resolution_served": 1024,
  "alpha_mode": "OPAQUE",
  "packed": true,
  "views_used": 1,
  "queue_ms": 1820,
  "gpu_ms": 61234,
  "elapsed_ms": 63010,
  "params": {
    "seed": 42, "texture_size": 4096, "decimation_target": 1000000,
    "sampler": {"sparse_structure": {"steps": 12, "guidance_strength": 7.5}, "…": "…"}
  }
}
```

A finished task reports what ran, not what was asked for: `params` holds the
seed, the clamped bake values and every stage's effective sampler settings;
`queue_ms` is acceptance to GPU start (model load on a cold instance plus any job
ahead), `gpu_ms` is the sampling and bake call, and `elapsed_ms` adds image
decode and upload. `GET /` and `GET /health` list `features`
(`seed`, `bake_overrides`, `sampler_params`, `timings`) so the platform can tell
this build from an older revision that silently ignores those fields.

A request the GPU cannot hold is retried one size down (1536 to 1024 to 512) and
`resolution_served` reports the step so the platform never pretends a stepped-down
result was the requested one. `status` is one of `queued`, `processing`,
`completed`, `failed`.

## Run it and call it

```bash
# Build and run on a machine with an NVIDIA GPU (24 GB or more).
docker build -t model-trellis2 workers/model-trellis2
docker run --gpus all -p 8080:8080 \
  -e API_KEY=dev-secret -e OUTPUT_DIR=/data \
  -e WEIGHTS_GCS_URI=gs://three-ws-model-weights/trellis2-4b \
  -v "$PWD/data:/data" model-trellis2

# Submit and poll.
TASK=$(curl -s -X POST localhost:8080/infer \
  -H "Authorization: Bearer dev-secret" -H "content-type: application/json" \
  -d '{"images":["https://example.com/front.png"],"resolution":1024}' | jq -r .task_id)
curl -s localhost:8080/tasks/$TASK -H "Authorization: Bearer dev-secret"
```

Through the platform the same lane is reached with
`POST /api/forge` using `{"path":"image","backend":"trellis2","resolution":1024}`,
or implicitly: it is the default for every image-to-3D tier. The catalog
(`GET /api/forge?catalog`) lists the accepted `resolutions` on the `trellis2`
backend.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `API_KEY` | none | Shared bearer secret (Secret Manager `avatar-reconstruction-key` on Cloud Run). |
| `GCS_BUCKET` | unset | Output bucket. Unset uses `OUTPUT_DIR`. |
| `OUTPUT_DIR` | `/tmp/outputs` | Task and result volume for standalone use. |
| `WEIGHTS_DIR` | `/weights/trellis2-4b` | Local weight tree (gcsfuse mount on Cloud Run). |
| `WEIGHTS_GCS_URI` | unset | `gs://` tree. Each sub-model streams to local disk, loads, then is deleted, so peak disk is one checkpoint. The full set (about 15 GiB) does not fit Cloud Run's in-memory filesystem otherwise. |
| `WEIGHTS_LOCAL_DIR` | `/tmp/trellis2-weights` | Scratch for that streaming. |
| `MAX_RESOLUTION` | `1536` | Ceiling on the served resolution. |
| `MAX_CONCURRENT` | `1` | Parallel inferences per instance. One GPU, so instance count is the concurrent-generation count. |
| `IMAGE_FETCH_TIMEOUT_S` | `30` | Per-attempt image fetch timeout. |
| `MODEL_LOAD_ATTEMPTS` | `4` | Model-load attempts before the error latches and `/health` returns 503. |
| `MODEL_LOAD_RETRY_BASE_S`, `MODEL_LOAD_RETRY_CAP_S` | see `main.py` | Load-retry backoff bounds. |
| `BAKE_RASTER_BACKEND` | `nvdiffrast` | Rasteriser the GLB texture bake uses. `torch` selects the pure-PyTorch rasteriser in `bake_raster.py` (no nvdiffrast needed). See Licence notes. |
| `BAKE_RASTER_CANDIDATE_BUDGET` | `4194304` | Torch backend only: (texel, triangle) pairs tested per pass, which bounds its scratch memory (about 200 MB at the default). |

The platform side reads `MODEL_TRELLIS2_URL` (this service's URL) and
`GCP_RECONSTRUCTION_KEY` (the bearer secret) from the `three-ws-api` environment.
Until `MODEL_TRELLIS2_URL` is set the lane reports unconfigured and the router
skips it, so image-to-3D keeps working through the chain behind it.

## Files

| File | Role |
|---|---|
| `main.py` | FastAPI app, streaming weight loader, task store, GPU executor. |
| `request_policy.py` | Resolution presets, tier mapping, bake clamps, fetch-retry policy. Pure logic. |
| `pipeline_config.py` | Rewrites the upstream `pipeline.json` to the licence-clean model set below. |
| `glb_pack.py` | Alpha-mode decision and meshopt packing through `gltfpack`. |
| `bake_raster.py` | One bake-rasteriser interface over nvdiffrast or a pure-PyTorch rasteriser, picked by `BAKE_RASTER_BACKEND`. Vendored byte-identical into `model-trellis`, `model-pixal3d` and `model-lato2` with `test_bake_raster.py`. |
| `bench_bake_raster.py` | Replays the o_voxel UV bake on real meshes (decoded with `scripts/forge/decode-glb-mesh.mjs`) and compares backends for time, coverage and per-texel agreement. |
| `stage_weights.sh` | One-time mirror of every upstream weight into `gs://three-ws-model-weights/trellis2-4b`. |
| `worker_security.py`, `instance_health.py`, `storage_backend.py` | Vendored shared modules, kept byte-identical by `npm run check:vendored`. |
| `test_image_layout.py` | Repo-side guard that `PYTHONPATH` never shadows a compiled extension (O-Voxel) with its source tree. |
| `Dockerfile`, `cloudbuild.yaml` | CUDA 12.4 image with the compiled extensions, and the Cloud Build deploy. |
| `test_*.py` | Unit and contract tests. They also run as the build-time gate inside the Dockerfile. |

## Deploy

GPU worker deploys are owner-gated. The image build compiles four CUDA extensions
and takes most of an hour on the 32-vCPU builder; the config pins the
`three-ws-build@` service account.

```bash
# 1. One time: mirror the weights (idempotent, skips what is already there).
workers/model-trellis2/stage_weights.sh

# 2. Build, push and deploy.
gcloud builds submit --config workers/model-trellis2/cloudbuild.yaml \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s) .

# 3. Point the API at it.
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars MODEL_TRELLIS2_URL=$(gcloud run services describe model-trellis2 \
  --region us-central1 --format='value(status.url)')
```

The service runs on one NVIDIA L4 (24 GB) with minimum instances `0`. The
us-central1 L4 grant is shared by every GPU lane, so a warm floor here is a quota
decision: the first request after idle pays the weight stream and model load
(`BACKENDS.trellis2.coldStartSeconds`), and the keep-warm cron does not warm this
lane by default. Raise the floor with
`gcloud run services update model-trellis2 --min-instances=1` when quota allows.

## Licence notes

TRELLIS.2 is MIT. Three upstream components were swapped so the whole image is
commercially usable and nothing sits behind a gate we cannot satisfy:

- **Background removal: BiRefNet (MIT) instead of RMBG-2.0.** RMBG-2.0 is
  CC BY-NC 4.0, which forbids commercial use.
- **Image conditioner: DINOv3 ViT-L/16 from an ungated mirror**
  (`camenduru/dinov3-vitl16-pretrain-lvd1689m`, which carries the DINOv3 licence
  text, staged at `trellis2-4b/dinov3/LICENSE.md`). The official `facebook/` repo
  is gated and the platform's Hugging Face token is refused on it. To use the
  official repo instead, accept the terms on its model page with the token's
  account, restage `dinov3/` from it, and nothing else changes.
- **Sparse-structure decoder** is taken from `microsoft/TRELLIS-image-large`
  (`ss_dec`), as the upstream pipeline references it by that name.

`pipeline_config.py` applies the first two swaps by rewriting the pipeline config
at load time; the upstream file stays untouched in the weights bucket. **`nvdiffrast` licence and the replacement.** The texture-bake rasteriser
that upstream `o-voxel` requires, NVIDIA's `nvdiffrast`, is under the NVIDIA Source
Code License (1-Way Commercial). Section 3.3 limits use of the Work to
non-commercial research or evaluation, with commercial use reserved to NVIDIA.
`bake_raster.py` closes this: `BAKE_RASTER_BACKEND=torch` bakes with a pure-PyTorch
rasteriser written from the rasterisation maths (no nvdiffrast code), and works on
an image without nvdiffrast. On 10 real TRELLIS.2 meshes it matches nvdiffrast's
coverage to within 0.02 points and differs only on edge texels inside nvdiffrast's
subpixel snapping band. The bake step is 3.4x slower at 2048 (about 63 ms per
job, roughly 0.1% of a job), so the default stays `nvdiffrast` until the torch
backend has run in production. Full benchmark and migration path:
[forge-3d-adoption addendum](../../docs/research/forge-3d-adoption-2026-10-30.md#addendum-2026-11-12-nvdiffrast-licence-and-the-replacement-bake-rasteriser).
No source or weights are redistributed, only generated GLBs.

Known limit, measured 2026-11-11 on image `server:fix11111641` (8 vCPU, 32 GiB, L4):
`512` finishes in about 50 s of GPU time. `1024` and `1536` complete all three
sampling stages, but the container is then killed with signal 9 in decode and
`to_glb`, so the failure is in host RAM, not VRAM. The instance holds 16.9 GiB right
after load (`memory after load` log line), and 32 GiB is the Cloud Run ceiling. The
worker steps down on CUDA out-of-memory and reports `resolution_served`, but a
host-RAM kill bypasses that and the API records the job as orphaned. Reducing the
resident host footprint, or the postprocess peak, is the open fix.

Related: [`../model-trellis`](../model-trellis) (TRELLIS v1, the failover behind
this lane), [`../../docs/forge-pipeline.md`](../../docs/forge-pipeline.md),
[`../../docs/ops/gcp-model-workers.md`](../../docs/ops/gcp-model-workers.md).
