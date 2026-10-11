# model-anigen: rigged-at-generation worker

Every other Forge image-to-3D lane (TRELLIS.2, Pixal3D, Hunyuan3D, TripoSG,
...) hands back a bare, unrigged mesh; animating it is a separate step
through `workers/rig` or `workers/rig-nonhuman`. This worker, built on
[AniGen](https://github.com/VAST-AI-Research/AniGen) (VAST-AI-Research, MIT,
LICENSE read 2026-10-11), predicts the mesh, its joint skeleton, and its
per-vertex skin weights in one pass, from one reference photo. The GLB it
writes is already animatable: no second rigging call needed.

## How it works

`AnigenImageTo3DPipeline` (imported directly, in-process: AniGen is a real
Python package, not a subprocess CLI) samples a sparse structure and a SLat
latent from the input image, decodes a mesh and a predicted skeleton
together, repairs the skeleton's parent hierarchy, transfers skin weights
onto the (optionally simplified) output mesh, and writes one GLB carrying
mesh + joints + parents + skin weights + predicted vertex colors
(`anigen/utils/export_utils.py`'s `convert_to_glb_from_data`). See
`pipeline.py` for the exact call.

## nvdiffrast: never installed

AniGen's raster-based texture bake and hole-fill stages import
`nvdiffrast.torch`. nvdiffrast's own license (NVLabs/nvdiffrast, "Nvidia
Source Code License (1-Way Commercial)", section 3.3) restricts use to
non-commercial research/evaluation, which this worker's monetized Forge lane
cannot satisfy. Rather than ship a restricted-license dependency, this
worker:

1. Never installs the `nvdiffrast` package (absent from the Dockerfile).
2. Always calls the pipeline with `fill_holes=False, texture_size=0`
   (`pipeline.py`), so the raster-dependent stages never run.
3. Applies a build-time source patch (`patch_anigen.py`) that removes the two
   module-level `import nvdiffrast.torch as dr` statements that would
   otherwise make the vendored checkout fail to import at all. A repo-wide
   search (`gh api search/code`, 2026-10-11) confirmed these are the ONLY two
   files in the inference-relevant package that reference nvdiffrast; neither
   patch touches nvdiffrast's own source, since it is never vendored.

`patch_anigen.py`'s docstring and `test_patch_anigen.py` (unit tests against
real excerpts of AniGen's own source) carry the full trace. `pytorch3d`
(Meta, BSD, license read 2026-10-11) is installed with no restriction.

## API

```
POST /infer      { images, seed?, job_id? }
                 -> 202 { task_id, status: "queued" }        (Bearer API_KEY)
GET  /tasks/:id  -> { task_id, status, result_gcs_url?, result_url?,
                      rigged, joint_count?, error? }
GET  /results/:id.glb -> generated GLB (local OUTPUT_DIR mode only)
GET  /health     -> { ok, model, gpu_available, gpu_name, load_error }
```

Same task shape as every other Forge image lane (`POST /infer` + poll
`GET /tasks/:id`), so the Forge router dispatches to it exactly as it does
TRELLIS.2 or Pixal3D. AniGen conditions on one image; when several are sent
the first is used and the task record reports `views_used: 1`.

## Deploy

One-time checkpoint staging (under `gs://three-ws-model-weights/anigen/`):

```bash
bash workers/model-anigen/stage-assets.sh
```

Build + deploy (Cloud Build pins the `three-ws-build@` service account):

```bash
gcloud builds submit --config workers/model-anigen/cloudbuild.yaml \
  --substitutions=SHORT_SHA=manual$(date +%s) .
```

Service: `model-anigen`, us-central1, 1x L4 (`--no-gpu-zonal-redundancy`),
scale-to-zero by default against the shared per-region L4 quota in
`docs/ops/gcp-credits-plan.md`.

Then point the Forge API at it:

```bash
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars MODEL_ANIGEN_URL=$(gcloud run services describe \
      model-anigen --region us-central1 --format='value(status.url)')
```

`MODEL_ANIGEN_URL` is unset by default, so until that command runs, the
`anigen` Forge backend stays inactive (same invariant as every other
self-hosted image lane).

## Local tests (no GPU needed)

```bash
cd workers/model-anigen
python3 test_patch_anigen.py   # nvdiffrast-removal patch, against real AniGen source
```

`test_app_contract.py` additionally proves the served contract, but it needs
the patched AniGen checkout and its CPU-side dependencies on `PYTHONPATH`, so
it runs inside the built image (`docker build -t model-anigen
workers/model-anigen`, which runs it as a build-time gate; see the Dockerfile
tail) rather than bare on a dev machine.

## Licensing

AniGen is MIT (LICENSE read 2026-10-11). pytorch3d is BSD. nvdiffrast is
never installed; see the section above.

## Environment

| Var | Default | Meaning |
|---|---|---|
| `API_KEY` | (secret) | shared bearer secret (`avatar-reconstruction-key`) |
| `GCS_BUCKET` | (optional) | output bucket for rigged GLBs; local `OUTPUT_DIR` storage when unset |
| `OUTPUT_DIR` | `/output` | local task/result volume when `GCS_BUCKET` is unset |
| `ANIGEN_CKPT_ROOT` | `/app` | root `entrypoint.sh` stages `ckpts/anigen/...` under |
| `MAX_CONCURRENT` | `1` | parallel inference jobs per instance |
| `WEIGHTS_ROOT` | `/weights/anigen` | staged checkpoints, read by `entrypoint.sh` |
| `MODEL_LOAD_ATTEMPTS` / `MODEL_LOAD_RETRY_BASE_S` / `MODEL_LOAD_RETRY_CAP_S` | `4` / `15` / `120` | model-load retry budget |
| `IMAGE_FETCH_TIMEOUT_S` | `30` | per-attempt image fetch timeout |

## Failure modes

| Reported `error` | Cause | Fix |
|---|---|---|
| `unsupported image source: ...` / `image source ... rejected` | bad or unreachable `images[0]` entry | fix the URL; rejected before touching the GPU |
| `AniGen reported success but wrote no output GLB` | the pipeline ran but produced nothing | retry; if persistent, check the input image actually shows one coherent subject |
| `AniGen produced a mesh with no predicted skeleton` | same as above, specifically an empty joint set | same as above |
| `pipeline unavailable: ...` / `pipeline not ready` | checkpoint load failed or is still in progress | check `/health`'s `load_error`; retry once the instance reports ready |
| `internal error (ref <id>)` | anything unexpected | grep the service logs for the correlation id |
