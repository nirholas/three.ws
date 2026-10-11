# model-holopart: complete-hidden-parts worker

`workers/segment` splits a mesh at its visible seams, but each resulting part
is an open shell where it touched a neighbor or was hidden from every camera
angle. This worker, built on
[HoloPart](https://github.com/VAST-AI-Research/HoloPart) (VAST-AI-Research,
MIT, LICENSE read 2026-10-11), takes an already part-segmented mesh and
generates the missing geometry for every part, closing each one into a
complete, standalone shape. This is the "Complete hidden parts" lane behind
segment (work order 070); `model-partcrafter` is the companion worker that
generates parts straight from a 2D image instead of completing an
already-segmented mesh.

## How it works

`HoloPartPipeline` (imported directly, in-process: HoloPart is a real Python
package on its own checkout, not a subprocess CLI) reads a `trimesh.Scene`
whose geometries are already the named parts (exactly the shape
`workers/segment` emits, one node per part), builds per-part and whole-object
point-cloud conditioning tensors, and decodes a geometrically complete mesh
for every part. See `pipeline.py` for the exact call, adapted directly from
upstream's own `scripts/inference_holopart.py`.

Upstream's script already writes `part_mesh.name = part_id_list[i]` on every
output part, so node names survive this pass with zero extra engineering:
the node name a caller passed in is the exact node name that comes back.
That is the stability guarantee work order 070's Task 3 (and work order 078,
"keep the rig") depends on. This worker re-tints each completed part with the
same golden-ratio hue stepping `workers/segment` and `model-partcrafter` use,
so a completed part keeps the color a caller already associated with its id.

## API

```
POST /infer      { mesh_url, seed?, job_id? }
                 -> 202 { task_id, status: "queued" }        (Bearer API_KEY)
GET  /tasks/:id  -> { task_id, status, result_gcs_url?, result_url?,
                      parts?, part_count?, error? }
GET  /results/:id.glb -> completed GLB (local OUTPUT_DIR mode only)
GET  /health     -> { ok, model, gpu_available, gpu_name, load_error }
```

`mesh_url` must point at a GLB/GLTF with at least two named part geometries
(the output of `workers/segment`, `model-partcrafter`, or any other
SAMPart3D/SAMesh-style splitter); FBX and single-geometry meshes are refused
up front with a caller-facing message rather than failing opaquely on the
GPU. A meshopt-compressed input (`EXT_meshopt_compression`, what most
three.ws avatars ship) is transcoded before load, same as every other
caller-glTF-reading worker.

## Deploy

One-time weight staging (under `gs://three-ws-model-weights/holopart/`):

```bash
bash workers/model-holopart/stage-assets.sh
```

Build + deploy (Cloud Build pins the `three-ws-build@` service account):

```bash
gcloud builds submit --config workers/model-holopart/cloudbuild.yaml \
  --substitutions=SHORT_SHA=manual$(date +%s) .
```

Service: `model-holopart`, us-central1, 1x L4 (`--no-gpu-zonal-redundancy`),
scale-to-zero by default against the shared per-region L4 quota in
`docs/ops/gcp-credits-plan.md`.

Then point the Forge API at it:

```bash
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars MODEL_HOLOPART_URL=$(gcloud run services describe \
      model-holopart --region us-central1 --format='value(status.url)')
```

`MODEL_HOLOPART_URL` is unset by default, so until that command runs, the
`holopart` Forge backend stays inactive (same invariant as every other
self-hosted lane: it is opt-in only, never a default or a failover target).

## Local tests (no GPU needed)

```bash
cd workers/model-holopart
python3 -m py_compile main.py pipeline.py storage_backend.py worker_security.py gltf_meshopt.py test_gltf_meshopt.py test_app_contract.py
python3 test_gltf_meshopt.py
```

`test_app_contract.py` additionally proves the served contract (auth
boundary, request validation, SSRF guard, health reporting, the
fewer-than-two-parts guard), but it needs torch, FastAPI, trimesh, and the
vendored HoloPart checkout on `PYTHONPATH`, so it runs inside the built image
(`docker build -t model-holopart workers/model-holopart`, which runs it as a
build-time gate; see the Dockerfile tail) rather than bare on a dev machine.

## Licensing

HoloPart is MIT (LICENSE read 2026-10-11).

## Environment

| Var | Default | Meaning |
|---|---|---|
| `API_KEY` | (secret) | shared bearer secret (`avatar-reconstruction-key`) |
| `GCS_BUCKET` | (optional) | output bucket for completed GLBs; local `OUTPUT_DIR` storage when unset |
| `OUTPUT_DIR` | `/output` | local task/result volume when `GCS_BUCKET` is unset |
| `HOLOPART_WEIGHTS_ROOT` | `/app/pretrained_weights/HoloPart` | local root `entrypoint.sh` stages weights into |
| `MAX_CONCURRENT` | `1` | parallel inference jobs per instance |
| `WEIGHTS_ROOT` | `/weights/holopart` | staged weights, read by `entrypoint.sh` |
| `MODEL_LOAD_ATTEMPTS` / `MODEL_LOAD_RETRY_BASE_S` / `MODEL_LOAD_RETRY_CAP_S` | `4` / `15` / `120` | model-load retry budget |
| `MESH_FETCH_TIMEOUT_S` | `60` | per-attempt mesh fetch timeout |

## Failure modes

| Reported `error` | Cause | Fix |
|---|---|---|
| `refused to fetch mesh ...` / `mesh source ... rejected` | bad, unreachable, or unsafe `mesh_url` | fix the URL; rejected before touching the GPU |
| `HoloPart needs an already part-segmented GLB or GLTF: ...` | FBX input, or a mesh with fewer than two named geometries | segment the mesh first (`workers/segment` or `model-partcrafter`) |
| `HoloPart completed no usable parts from this mesh` | every decoded part came back empty | retry; if persistent, check the input parts are each a coherent, non-degenerate shape |
| `pipeline unavailable: ...` / `pipeline not ready` | weight load failed or is still in progress | check `/health`'s `load_error`; retry once the instance reports ready |
| `internal error (ref <id>)` | anything unexpected | grep the service logs for the correlation id |
