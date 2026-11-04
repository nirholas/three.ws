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

## DSINE: replaced with Marigold normals

AniGen conditions its sparse-structure flow on a surface-normal map of the
input photo. Upstream estimates it with DSINE, which `from_pretrained` pulls
from an unpinned GitHub branch (`hugoycj/DSINE-hub:main`) at load time.
DSINE's licence (Imperial College, clause 2(b), read 2026-11-04) permits use
"solely for non-commercial, internal or academic research purposes", so this
worker never loads it:

1. `patch_anigen.py` swaps the single `load_dsine(device)` call for
   `normal_estimator.load_normal_estimator(device)`, and an AST scan fails
   the build if any other `load_dsine` call site appears after a bump.
2. `normal_estimator.py` runs
   [Marigold normals](https://huggingface.co/prs-eth/marigold-normals-lcm-v0-1)
   (Apache-2.0, pinned revision `28214f06`) through diffusers'
   `MarigoldNormalsPipeline`, offline from the staged checkpoint, 4 LCM
   steps x 5-member ensemble at 768 px, seeded so the same photo gives the
   same map.
3. Marigold's frame (x right, y up, z to the viewer) is converted to DSINE's
   (OpenCV axes, normals along the view ray, which is `(-x, y, z)`), so after
   AniGen's own `estimate_normal` post-processing the conditioning map is
   the same OpenGL-style normal map DSINE produced. `test_normal_estimator.py`
   proves the conversion on an analytic sphere and, inside the image, through
   the real upstream `estimate_normal`.

Background removal stays upstream's `rembg` BiRefNet (MIT); its ONNX model
is baked into the image at build time instead of downloaded on first request.

## Checkpoints staged per instance

AniGen resolves every checkpoint relative to the process cwd, so
`entrypoint.sh` copies exactly the serving set into `ANIGEN_CKPT_ROOT/ckpts/`
and serves from there (`uvicorn --app-dir /app`):

| Path under `ckpts/` | Size | Used for |
|---|---|---|
| `anigen/ss_flow_solo` | 3.14 GiB | sparse-structure flow |
| `anigen/slat_flow_auto` | 2.29 GiB | SLat flow |
| `anigen/{ss_dae,slat_dae}` (config + `decoder_final.pt`) | 1.38 GiB | decoders |
| `dinov2` (local hub repo + reg4 weights) | 1.14 GiB | image conditioning |
| `marigold-normals-lcm-v0-1` | 2.40 GiB | normal conditioning |

10.4 GiB in total (measured 2026-11-04). Cloud Run's writable filesystem is
in memory, so the service runs at 8 vCPU / 32 GiB. The first europe-west4
revision copied the whole 18 GiB bucket tree (unused flows, both encoders,
DSINE, VGG) into a 16 GiB container, never staged DINOv2, and never passed
its startup probe; `test_entrypoint.py` pins the staged set so that cannot
recur. A missing checkpoint fails the entrypoint before serving, naming the
file.

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

Service: `model-anigen`, **europe-west4**, 1x L4 (`--no-gpu-zonal-redundancy`),
8 vCPU / 32 GiB, scale-to-zero. The image stays in the us-central1 registry (`_REGION`); the
service runs in `_RUN_REGION`. us-central1's L4 quota is 3, an increase was
denied, and the three min-instance workers (`model-rig`, `model-rig-nonhuman`,
`model-trellis`) hold all of it, so the first us-central1 deploy failed on GPU
quota. europe-west4 has 8 L4s approved. The `three-ws-model-weights` bucket
mounts cross-region, so a cold start copies the checkpoints over a longer path.

Then point the Forge API at it:

```bash
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars MODEL_ANIGEN_URL=$(gcloud run services describe \
      model-anigen --region europe-west4 --format='value(status.url)')
```

`MODEL_ANIGEN_URL` is unset by default, so until that command runs, the
`anigen` Forge backend stays inactive (same invariant as every other
self-hosted image lane).

## Local tests (no GPU needed)

```bash
cd workers/model-anigen
python3 test_patch_anigen.py     # nvdiffrast + DSINE patches, against real AniGen source
python3 test_entrypoint.py       # checkpoint staging: exact serving set, cwd, fail-fast
python3 test_normal_estimator.py # Marigold -> DSINE frame conversion (predictor test needs torch)
```

`test_app_contract.py` additionally proves the served contract, but it needs
the patched AniGen checkout and its CPU-side dependencies on `PYTHONPATH`, so
it runs inside the built image (`docker build -t model-anigen
workers/model-anigen`, which runs it as a build-time gate; see the Dockerfile
tail) rather than bare on a dev machine.

## Licensing

AniGen is MIT (LICENSE read 2026-10-11, re-read 2026-11-03). pytorch3d is
BSD. Marigold normals and diffusers are Apache-2.0; rembg is MIT. nvdiffrast
is never installed and DSINE is never loaded; see the sections above.

Upstream later appended a note to its LICENSE and added
`THIRD_PARTY_LICENSES.md` (which is why GitHub now reports the repo as
`NOASSERTION`): AniGen's own code stays MIT, but the bundled
`extensions/CUBVH` contains a BVH from instant-ngp under the NVIDIA Source
Code License, restricted to non-commercial use. This worker never builds
`extensions/` or runs upstream's `setup.sh`, and AniGen imports `cubvh` only
from its training code (`anigen/datasets/`, `anigen/trainers/`), never from
the inference pipeline we run. When bumping the pinned commit, keep it that
way: do not install anything from `extensions/`.

## Environment

| Var | Default | Meaning |
|---|---|---|
| `API_KEY` | (secret) | shared bearer secret (`avatar-reconstruction-key`) |
| `GCS_BUCKET` | (optional) | output bucket for rigged GLBs; local `OUTPUT_DIR` storage when unset |
| `OUTPUT_DIR` | `/output` | local task/result volume when `GCS_BUCKET` is unset |
| `ANIGEN_CKPT_ROOT` | `/app` | root `entrypoint.sh` stages `ckpts/...` under and serves from (AniGen loads relative to the cwd) |
| `NORMALS_MODEL_PATH` | `ckpts/marigold-normals-lcm-v0-1` | Marigold normals checkpoint directory |
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
