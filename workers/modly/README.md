# model-modly: Modly's image-to-3D backend, headless on a Cloud Run GPU

Based on [Modly](https://github.com/lightningpixel/modly) by
[Lightning Pixel](https://github.com/lightningpixel), MIT license. Modly's
LICENSE ships inside the image at `/app/licenses/MODLY-LICENSE`.

Modly is a desktop app that runs open image-to-3D models locally through
installable extensions. This worker runs Modly's own FastAPI backend, unchanged
and pinned to a commit, as a child process on a Cloud Run NVIDIA L4, and puts the
same authenticated task contract every other three.ws model worker speaks in
front of it. The Forge reaches it as two lanes:

| Forge backend id | Modly model | Weights | Licence |
|---|---|---|---|
| `modly` | `triposg/generate` (TripoSG, VAST AI) | `VAST-AI/TripoSG` | MIT |
| `modly_hunyuan` | `hunyuan3d-mini-turbo/generate` (Hunyuan3D 2 Mini Turbo) | `tencent/Hunyuan3D-2mini` | Tencent Hunyuan 3D 2.0 Community License (territory-gated like every Hunyuan lane) |

Both produce untextured geometry. On top of generation the worker runs an
optional post-process chain, and the same chain can be applied to a mesh you
already have:

1. **repair** (Modly op): remove duplicate and degenerate faces, fix non-manifold
   edges, fill holes up to a size.
2. **decimate** (Modly op, meshoptimizer through Node): reduce to a target face
   count.
3. **smooth** (Modly op): Taubin or Laplacian smoothing.
4. **uv_unwrap** (this worker, xatlas): a fresh UV atlas.
5. **bake** (this worker, numpy/scipy): transfer colour from the mesh as it was
   before steps 1 to 3 onto the new atlas.

The finished GLB is meshopt-compressed with the pinned `gltfpack` binary.

## Endpoints

`POST /infer`, `GET /tasks/{id}` and `GET /results/{id}.glb` require
`Authorization: Bearer $API_KEY`. `GET /health` and `GET /` are unauthenticated
and carry no secrets: the platform reads them to decide whether the lane can take
work. Modly's own API listens on `127.0.0.1` only and is never exposed (it has no
auth and its optimize routes take filesystem paths).

### `POST /infer`

Image to 3D:

```json
{
  "images": ["https://example.com/front.png"],
  "model": "triposg",
  "tier": "standard",
  "seed": 42,
  "params": { "guidance_scale": 7.0, "faces": 50000 },
  "postprocess": { "repair": true, "decimate": 20000, "smooth": { "iterations": 3 } }
}
```

Post-process an existing mesh (no generation):

```json
{
  "mesh_url": "https://example.com/avatar.glb",
  "postprocess": { "repair": true, "decimate": 5000, "bake": { "texture_size": 1024 } }
}
```

| Field | Meaning |
|---|---|
| `images` | 1 to 6 `https://` URLs or `data:` URIs. Both models condition on one image, so the first is the subject. URLs are SSRF-checked. |
| `mesh_url` | One `https://` URL or `data:` URI of a `.glb`, `.gltf`, `.obj`, `.ply` or `.stl`. Meshopt-compressed GLBs (most three.ws avatars) are decoded first. Needs at least one `postprocess` step. Send exactly one of `images` or `mesh_url`. |
| `model` | `triposg` (default) or `hunyuan3d-mini-turbo` (aliases `hunyuan`, `tripo`, or the full Modly id). A model this deployment does not serve is a `422`. |
| `tier` | `draft`, `standard`, `high`, `max`. TripoSG maps it to 20/30/50/50 steps; Hunyuan Mini Turbo to 5/10/20/20 steps at octree 256/380/512/512. |
| `seed` | 0 to 4294967295. Omitted, the worker picks one and reports it, so every result is reproducible. |
| `params` | Per-model knobs, clamped to the extension's own schema. TripoSG: `num_inference_steps` 8 to 50, `guidance_scale` 0 to 20, `foreground_ratio` 0.5 to 1, `faces` -1 (no cap) to 500000, `use_flash_decoder` `DiffDMC` or `Marching Cubes`. Hunyuan: `num_inference_steps` 5/10/20, `octree_resolution` 256/380/512, `guidance_scale` 1 to 10. Unknown keys are dropped and listed in `params_dropped`. |
| `postprocess.repair` | `true` or `{remove_duplicates, fix_non_manifold, remove_degenerate, fill_holes, max_hole_size (10 to 10000)}`. |
| `postprocess.decimate` | A face count (100 to 1000000) or `{target_faces}`. |
| `postprocess.smooth` | `true` or `{iterations (1 to 50), lambda (0.1 to 1), mode: "taubin" \| "laplacian"}`. |
| `postprocess.uv_unwrap` | `true`. |
| `postprocess.bake` | `true` (1024) or `{texture_size: 256 \| 512 \| 1024 \| 2048 \| 4096}`. Implies `uv_unwrap`. A source with no colour is reported, never baked flat grey. |

Steps always run in the order above, whatever order the keys arrive in. Response:
`202 {"task_id": "...", "status": "queued", "model": "triposg/generate"}`.

### `GET /tasks/{id}`

```json
{
  "task_id": "...",
  "status": "done",
  "model": "triposg/generate",
  "seed": 42,
  "params": { "num_inference_steps": 30, "guidance_scale": 7.0, "seed": 42 },
  "result_gcs_url": "https://storage.googleapis.com/three-ws-avatar-reconstructions/raw-meshes/modly/....glb",
  "postprocess_applied": [{ "step": "decimate", "target_faces": 20000 }],
  "packed": true,
  "bytes": 812345,
  "elapsed_ms": 41210
}
```

`status` is `queued`, `running` (with `progress` 0 to 100 and the Modly `step`),
`done` or `failed` (with `error`). `postprocess_applied` lists each step that ran
with its settings and the details Modly's op reported. Without `GCS_BUCKET` the record carries
`result_url: /results/{id}.glb` instead. A task whose instance died mid-run is
reported `failed` once its heartbeat goes stale, never left `running` forever.

### `GET /health`

`200` while bringing up and when ready, `503` once bring-up has spent its retry
budget (the Cloud Run liveness probe then recycles the instance). It reports
`ready`, `models`, `gpu_name`, `modly_alive`, `modly_restarts`, `warmup_ms`,
`load_error`, `draining` and `postprocess_steps`.

## How it runs

1. **Weights.** On start the front copies `WEIGHTS_GCS_URI/<extension>/` for each
   enabled model into `MODELS_DIR` (the layout Modly reads), eight files at a time.
2. **Modly.** It starts Modly's `uvicorn main:app` on `127.0.0.1:MODLY_PORT` with a
   scrubbed environment (no `API_KEY`), waits for `/model/all`, and checks that
   every enabled model is registered, downloaded and free of extension errors.
3. **Warm-up.** One draft generation runs so the first caller does not pay the
   model load.
4. **Supervision.** A watchdog checks Modly every 5 seconds and brings it back if
   it exits. A job in flight when that happens fails with a retryable error.
5. **Memory.** After each job the front trims its heap and recycles the instance
   if resident memory has grown past the configured ceiling.

Each extension runs in its own venv, exactly as Modly's installer would build it,
except that both venvs share one torch install in the system interpreter
(`--system-site-packages`), which saves about 5 GB of image.

## Run it and call it

```bash
# On a machine with an NVIDIA GPU (24 GB or more) and gcloud credentials that can
# read gs://three-ws-model-weights:
docker build -t model-modly workers/modly
docker run --gpus all -p 8080:8080 \
  -e API_KEY=dev-secret -e OUTPUT_DIR=/data \
  -e WEIGHTS_GCS_URI=gs://three-ws-model-weights/modly \
  -v "$PWD/data:/data" model-modly

TASK=$(curl -s -X POST localhost:8080/infer \
  -H "Authorization: Bearer dev-secret" -H "content-type: application/json" \
  -d '{"images":["https://example.com/front.png"],"model":"triposg","postprocess":{"decimate":20000}}' \
  | jq -r .task_id)
curl -s localhost:8080/tasks/$TASK -H "Authorization: Bearer dev-secret"
```

Through the platform: `POST /api/forge` with
`{"path":"image","backend":"modly"}` (TripoSG) or `{"backend":"modly_hunyuan"}`.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `API_KEY` | required | Shared bearer secret (Secret Manager `avatar-reconstruction-key` on Cloud Run). |
| `GCS_BUCKET` | unset | Output bucket; results land at `raw-meshes/modly/{task_id}.glb`. Unset uses `OUTPUT_DIR`. |
| `OUTPUT_DIR` | `/output` | Task and result volume for standalone use. |
| `MAX_CONCURRENT` | `1` | Parallel jobs per instance. One GPU, so instance count is the concurrency. |
| `MODLY_MODELS` | `triposg/generate,hunyuan3d-mini-turbo/generate` | Models this deployment serves. `triposg/generate` alone halves the weights held in memory. |
| `MODLY_DEFAULT_MODEL` | `triposg/generate` | Model used when a request names none. |
| `WEIGHTS_GCS_URI` | unset | `gs://` prefix the weights are copied from. Unset expects them already in `MODELS_DIR`. |
| `MODELS_DIR` | `/tmp/modly-models` | Where Modly reads weights. |
| `WORKSPACE_DIR` | `/tmp/modly-workspace` | Modly's output workspace; each task's directory is removed when it finishes. |
| `EXTENSIONS_DIR` | `/opt/modly-extensions` | The pinned extensions and their venvs (set in the image). |
| `MODLY_API_DIR` | `/opt/modly/api` | The pinned Modly backend (set in the image). |
| `MODLY_PORT` | `8765` | Loopback port for Modly. |
| `MODLY_START_TIMEOUT_S` | `180` | How long Modly may take to answer after start. |
| `MODLY_WARMUP` | `1` | `0` skips the warm-up generation. |
| `GENERATION_TIMEOUT_S` | `600` | Per-generation ceiling; the Modly job is cancelled past it. |
| `IMAGE_FETCH_TIMEOUT_S` | `30` | Per-attempt fetch timeout for `images` and `mesh_url`. |
| `MODEL_LOAD_ATTEMPTS` | `4` | Bring-up attempts before the error latches and `/health` returns 503. |
| `MODEL_LOAD_RETRY_BASE_S`, `MODEL_LOAD_RETRY_CAP_S` | `15`, `120` | Bring-up backoff bounds. |

The platform reads `MODEL_MODLY_URL` (this service's URL) and
`GCP_RECONSTRUCTION_KEY` (the bearer secret) from the `three-ws-api` environment.
Until `MODEL_MODLY_URL` is set both lanes report unconfigured and the router skips
them; `trellis2` stays the default image-to-3D lane either way.

## Pins

| Component | Pin |
|---|---|
| Modly | `lightningpixel/modly` at `f11a4d2bd9fe994b9d30f76a36cb6c18ac8733ea` (v0.4.3) |
| TripoSG extension | `lightningpixel/modly-triposg-extension` at `cc30cb8bedddf8141e78dc6cf88a4cb1a305d128` |
| Hunyuan3D Mini Turbo extension | `lightningpixel/modly-hunyuan3d-mini-turbo-extension` at `9457b71b6e3ee5436240cac0d6c1bbcd02e9f53d` |
| TripoSG source | `VAST-AI-Research/TripoSG` at `fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c` |
| Hunyuan3D-2 source (`hy3dgen`) | `Tencent-Hunyuan/Hunyuan3D-2` at `f8db63096c8282cb27354314d896feba5ba6ff8a` |
| diso (DiffDMC decoder) | `SarahWeiii/diso` at `9792ad928ccb09bdec938779651ee03e395758a6` |
| TripoSG weights | `VAST-AI/TripoSG` at `2c1c516d22d58db486a058d98d31bb6177344e06` (about 7.9 GB) |
| Hunyuan3D 2 Mini weights | `tencent/Hunyuan3D-2mini` at `f90a0f7df7d5e6f71109cf333f6a95a0ae3194a6` (turbo DiT and VAE only, about 4.2 GB) |
| torch | 2.6.0 + cu124, torchvision 0.21.0 |
| Node | v20.18.1, sha256 checked |
| meshoptimizer runtime | `meshopt/package-lock.json` (`@gltf-transform/*` 3.10.1, `meshoptimizer` 0.22.0) |
| rembg u2net.onnx | sha256 `8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491` |
| gltfpack | v1.2, sha256 checked |

Every Python dependency is pinned in `requirements-host.txt`,
`requirements-triposg.txt` and `requirements-hunyuan.txt`.

Official Modly extensions that are NOT shipped, and why: Hunyuan3D 2 Mini
(`c927d5657249f91d09bb912900d5d4f7b26725fb`) and Mini Fast
(`56a0bab6b039d9922d3ab228941eb8cd0dbb9ff2`) are slower step-count variants of
the Hunyuan3D 2 Mini family the Turbo lane already serves; TRELLIS.2 GGUF
(`caa85c7a1aa6c6ba9cb3f07f13878ba8e3864912`) duplicates the full-precision
`trellis2` lane the Forge already runs on its own worker.

## Licences

- **Modly**: MIT, Copyright (c) 2026 Lightning Pixel. `/app/licenses/MODLY-LICENSE`.
- **TripoSG**: MIT (code and weights). `/app/licenses/TRIPOSG-LICENSE` is the
  source repo's licence; the weight repo declares MIT in its model card and ships
  no separate licence file.
- **Hunyuan3D 2**: Tencent Hunyuan 3D 2.0 Community License. It does not apply in
  the European Union, the United Kingdom or South Korea, so `modly_hunyuan` is in
  `TENCENT_LANES` (`api/_lib/forge-territory.js`) and is never routed for a caller
  there. `/app/licenses/HUNYUAN3D-2-LICENSE` and `HUNYUAN3D-2-NOTICE` ship in the
  image; the weight repo's LICENSE and NOTICE are staged beside the weights.
- **Modly's `uv_unwrapper` and `texture_baker` are not built.** They are derived
  from Stability AI's stable-fast-3d under the Stability AI Community License, not
  MIT. `postprocess.py` replaces them with xatlas (MIT) and a numpy/scipy (BSD)
  bake.
- **Background removal** uses rembg (MIT) with the u2net model (Apache 2.0).

## Files

| File | Role |
|---|---|
| `main.py` | The front: auth, task store, weight staging, Modly start and supervision, the job runner. |
| `request_policy.py` | Model aliases, tier presets, param clamps, post-process plan, Modly status mapping. Pure logic. |
| `postprocess.py` | xatlas UV unwrap, colour bake, gltfpack packing. |
| `stage_weights.sh` | One-time mirror of both weight sets into `gs://three-ws-model-weights/modly`. |
| `meshopt/` | The pinned Node packages Modly's decimate op loads. |
| `worker_security.py`, `instance_health.py`, `storage_backend.py`, `gltf_meshopt.py` | Vendored shared modules, kept byte-identical by `npm run check:vendored`. |
| `Dockerfile`, `cloudbuild.yaml` | The CUDA 12.4 image and the Cloud Build deploy. |
| `test_*.py` | Unit tests and the contract test. Both run as the build-time gate in the Dockerfile; the contract test also starts the pinned Modly with both extensions and runs its repair, decimate and smooth ops. |

Run the tests without a GPU (the contract test skips its Modly part when
`/opt/modly` is absent):

```bash
cd workers/modly
python3 -m pip install -r requirements-host.txt
python3 -m pytest test_request_policy.py test_postprocess.py test_gltf_meshopt.py \
  test_instance_health.py test_storage_backend.py -q -p no:cacheprovider
python3 test_app_contract.py
```

## Deploy

GPU worker deploys are owner-gated. The config pins the `three-ws-build@` build
account and runs as `three-ws@`.

```bash
# 1. One time: mirror the weights (idempotent, skips what is already there).
workers/modly/stage_weights.sh

# 2. Build, push and deploy.
gcloud builds submit --config workers/modly/cloudbuild.yaml \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s) .

# 3. Point the API at it.
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars MODEL_MODLY_URL=$(gcloud run services describe model-modly \
  --region us-central1 --format='value(status.url)')
```

### One-time GCP setup (already applied in `aerial-vehicle-466722-p5`)

```bash
gcloud artifacts repositories create model-modly --repository-format=docker \
  --location us-central1
gcloud storage buckets add-iam-policy-binding gs://three-ws-model-weights \
  --member serviceAccount:three-ws@aerial-vehicle-466722-p5.iam.gserviceaccount.com \
  --role roles/storage.objectViewer
gcloud storage buckets add-iam-policy-binding gs://three-ws-avatar-reconstructions \
  --member serviceAccount:three-ws@aerial-vehicle-466722-p5.iam.gserviceaccount.com \
  --role roles/storage.objectAdmin
```

The service runs on one NVIDIA L4 (24 GB) with 32 GiB of memory and minimum
instances `0`. The us-central1 L4 grant is shared by every GPU lane, so a warm
floor is a quota decision: the first request after idle pays the weight copy,
the Modly start and the warm-up (`BACKENDS.modly.coldStartSeconds`). Raise it with
`gcloud run services update model-modly --min-instances=1` when quota allows, or
add `modly` to `FORGE_KEEPWARM_LANES`.

Related: [`../model-trellis2`](../model-trellis2) (the default image-to-3D lane),
[`../../docs/forge-pipeline.md`](../../docs/forge-pipeline.md),
[`../../docs/ops/gcp-model-workers.md`](../../docs/ops/gcp-model-workers.md).
