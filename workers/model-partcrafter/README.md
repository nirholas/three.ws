# model-partcrafter: editable-parts generation worker

Every other Forge image-to-3D lane (TRELLIS.2, Pixal3D, Hunyuan3D, TripoSG,
AniGen, ...) hands back one undivided mesh. This worker, built on
[PartCrafter](https://github.com/wgsxm/PartCrafter) (wgsxm, MIT, LICENSE read
2026-10-11, NeurIPS 2025), decodes a reference photo straight into N
individually named part meshes in a single diffusion-transformer pass, so the
result is editable (recolor, swap, regenerate one part) from the moment it is
generated. This is the Forge "Parts" lane for work order 070; `model-holopart`
is the companion worker that completes occluded geometry on meshes that were
part-segmented after the fact (by `workers/segment`), rather than generated
with parts already separated.

## How it works

`PartCrafterPipeline` (imported directly, in-process: PartCrafter is a real
Python package on its own checkout, not a subprocess CLI) conditions a shared
TripoSG-derived diffusion transformer on the SAME background-removed
reference image once per requested part
(`attention_kwargs={"num_parts": N}`), and decodes all N meshes in one
forward pass. See `pipeline.py` for the exact call.

Before that, `matting.py` prepares the reference image the way PartCrafter
was trained to see it: the subject is isolated with BiRefNet (MIT, run on the
GPU through onnxruntime-gpu), composited on white, cropped to its bounding box
and centred in a square with 10% padding. A transparent PNG's own alpha is
used directly instead of re-matting. An image with no isolatable subject
fails the job with a clear message before any diffusion work starts.

Upstream's own script (`scripts/inference_partcrafter.py`) exports each part
as its own `part_{i:02}.glb` file plus a separately merged `object.glb`. This
worker instead builds ONE GLB scene with named nodes directly
(`part_01`, `part_02`, ... one-indexed, two digits) and tints each part with
the same golden-ratio hue stepping `workers/segment` uses
(`hue = (index * 0.618033988749895) % 1.0`), so a PartCrafter generation and a
post-hoc segmentation are indistinguishable in shape to every downstream
consumer: Restyle Studio's part-editing UI, Parts Studio, and the node-name
stability contract work order 078 ("keep the rig") depends on.

The image applies two small fixes to the pinned checkout at build time
(`patch_upstream.py`; the build fails if either target line moves). Upstream
decodes each part inside a bare `except:` that discards the exception, so a
part that runs out of memory or decodes to no surface left no trace in the
logs; the patch logs the traceback (logger `partcrafter.decode`) and keeps
upstream's skip-that-part behaviour. And upstream's octree expansion hardcodes
`device='cuda'`, which made every decode off a GPU fail silently through that
same `except:`; it now follows the input tensor's device.

## API

```
POST /infer      { images, num_parts (2-16), seed?, job_id? }
                 -> 202 { task_id, status: "queued" }        (Bearer API_KEY)
GET  /tasks/:id  -> { task_id, status, result_gcs_url?, result_url?,
                      parts?, part_count?, views_used?, error? }
GET  /results/:id.glb -> generated GLB (local OUTPUT_DIR mode only)
GET  /health     -> { ok, model, gpu_available, gpu_name, load_error }
```

Same task shape as every other Forge image lane (`POST /infer` + poll
`GET /tasks/:id`), so the Forge router dispatches to it exactly as it does
TRELLIS.2 or AniGen. PartCrafter conditions on one image; when several are
sent the first is used and the task record reports `views_used: 1`. The
`parts` array on a completed task is shaped identically to
`workers/segment`'s own manifest entries: `{id, name, region, face_count,
vertex_count, bbox, centroid, volume, color}`.

## Deploy

One-time weight staging (under `gs://three-ws-model-weights/partcrafter/`):

```bash
bash workers/model-partcrafter/stage-assets.sh
```

Build + deploy (Cloud Build pins the `three-ws-build@` service account):

```bash
gcloud builds submit --config workers/model-partcrafter/cloudbuild.yaml \
  --substitutions=SHORT_SHA=manual$(date +%s) .
```

Service: `model-partcrafter`, us-central1, 1x L4 (`--no-gpu-zonal-redundancy`),
scale-to-zero by default against the shared per-region L4 quota in
`docs/ops/gcp-credits-plan.md`.

Then point the Forge API at it:

```bash
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars MODEL_PARTCRAFTER_URL=$(gcloud run services describe \
      model-partcrafter --region us-central1 --format='value(status.url)')
```

`MODEL_PARTCRAFTER_URL` is unset by default, so until that command runs, the
`partcrafter` Forge backend stays inactive (same invariant as every other
self-hosted image lane: it is opt-in only, never a default or a failover
target).

## Local tests (no GPU needed)

```bash
cd workers/model-partcrafter
python3 -m py_compile main.py pipeline.py matting.py storage_backend.py worker_security.py test_app_contract.py
python3 test_matting.py
```

`test_matting.py` needs numpy, Pillow and scipy. Its geometry checks always
run (and run again in the image build). When the BiRefNet ONNX is present
(`MATTING_MODEL_PATH`) and onnxruntime is installed, it also mattes the CC0
chair photo in `data/quality-bench/refs/` with the real model; that pass takes
minutes on a CPU.

`test_app_contract.py` additionally proves the served contract (auth
boundary, request validation, SSRF guard, health reporting), but it needs
torch, FastAPI, and the vendored PartCrafter checkout on `PYTHONPATH`, so it
runs inside the built image (`docker build -t model-partcrafter
workers/model-partcrafter`, which runs it as a build-time gate; see the
Dockerfile tail) rather than bare on a dev machine. The same gate also
imports PartCrafter's whole inference chain against the pinned dependency
set, so upstream or dependency drift fails the build, not the first cold
start.

`test_patch_upstream.py` (also a build gate) proves the two upstream fixes
hold: the octree expansion runs on a CPU tensor, the part-decode handler
logs instead of discarding, and the patcher refuses a tree whose target
lines moved.

## Licensing

PartCrafter code and weights are MIT (LICENSE read 2026-10-11; model card
re-checked 2026-11-03). Background matting is BiRefNet (ZhengPeng7/BiRefNet,
MIT), using the ONNX export the rembg project (danielgatis/rembg, MIT)
publishes, pinned by SHA-256 in the Dockerfile.

Upstream PartCrafter's own preprocessing uses BRIA RMBG-1.4, whose model card
states it is "available as a source-available model for non-commercial use"
with a separately purchased commercial license. This worker therefore never
downloads or loads it; `matting.py` is this worker's own implementation of
the same framing step on a permissively licensed model.

## Environment

| Var | Default | Meaning |
|---|---|---|
| `API_KEY` | (secret) | shared bearer secret (`avatar-reconstruction-key`) |
| `GCS_BUCKET` | (optional) | output bucket for part-separated GLBs; local `OUTPUT_DIR` storage when unset |
| `OUTPUT_DIR` | `/output` | local task/result volume when `GCS_BUCKET` is unset |
| `PARTCRAFTER_WEIGHTS_ROOT` | `/app/pretrained_weights` | local root `entrypoint.sh` stages `PartCrafter/` under |
| `MATTING_MODEL_PATH` | `/app/models/birefnet-general.onnx` | BiRefNet ONNX baked into the image |
| `MAX_CONCURRENT` | `1` | parallel inference jobs per instance |
| `WEIGHTS_ROOT` | `/weights/partcrafter` | staged weights, read by `entrypoint.sh` |
| `MODEL_LOAD_ATTEMPTS` / `MODEL_LOAD_RETRY_BASE_S` / `MODEL_LOAD_RETRY_CAP_S` | `4` / `15` / `120` | model-load retry budget |
| `IMAGE_FETCH_TIMEOUT_S` | `30` | per-attempt image fetch timeout |

## Failure modes

| Reported `error` | Cause | Fix |
|---|---|---|
| `unsupported image source: ...` / `image source ... rejected` | bad or unreachable `images[0]` entry | fix the URL; rejected before touching the GPU |
| `no foreground subject found in the reference image` / `the reference image's subject is too small to reconstruct` | matting found nothing to frame (blank, uniform, or tiny subject) | send a photo where the object is clearly visible, or a transparent PNG cut-out |
| `PartCrafter decoded no usable parts from this image` | every decoded part was empty | retry with a clearer, more separable subject, or a lower `num_parts` |
| `pipeline unavailable: ...` / `pipeline not ready` | weight load failed or is still in progress | check `/health`'s `load_error`; retry once the instance reports ready |
| `internal error (ref <id>)` | anything unexpected | grep the service logs for the correlation id |
