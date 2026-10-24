# model-sam3d-objects: one photo to a laid-out 3D scene (SAM 3D Objects)

FastAPI inference service that rebuilds the **objects in a single photo as one 3D
scene GLB** with [SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects)
(Meta). Each object becomes a named node (`object_01`, `object_02`, ...) placed,
rotated and scaled the way it sits in the picture. The layout is relative, not
metric. It backs `POST /api/forge-scene-objects` and the AR Studio tray tab
"From a photo".

Upstream is pinned to commit `f91db411c50efee93d8db7aeb323885650f6f722`
(`SAM3D_COMMIT` in the Dockerfile).

## Status: off until the owner stages weights

The weights are gated on Hugging Face by manual approval under the SAM License
and the model needs a **32 GB+ GPU**, so the platform answers
`503 backend_unconfigured` until all of this is done:

1. Accept the SAM License and get access: <https://huggingface.co/facebook/sam-3d-objects>.
2. `HF_TOKEN=... npm run stage:sam3d-objects -- --accept-sam-license` (add `--dry-run` first to see the plan). It copies the checkpoints and the LICENSE to `gs://three-ws-model-weights/sam3d-objects/`.
3. Make sure the project has quota for the GPU class below, then
   `gcloud builds submit --config workers/model-sam3d-objects/cloudbuild.yaml --substitutions=SHORT_SHA=manual$(date +%s) .`
4. `gcloud run services update three-ws-api --region us-central1 --update-env-vars MODEL_SAM3D_URL=<service url>` (use `--update-env-vars`, never `--set-env-vars`). `GCP_RECONSTRUCTION_KEY` is shared with the other model workers.

## GPU class

The 24 GB L4 the other workers use cannot hold the model. `cloudbuild.yaml`
defaults to `nvidia-rtx-pro-6000` with 20 CPU and 80Gi memory (Cloud Run's floor
for that class). Override `_GPU_TYPE`, `_CPU`, `_MEMORY` together if the class
changes. Scale-to-zero is the default; a warm floor is a spend decision.

## Endpoints

`POST /infer`, `GET /tasks/{id}` and `GET /results/{id}.glb` need
`Authorization: Bearer $API_KEY`. `GET /` and `GET /health` are open (`/health`
returns 503 once a model load failure latches).

`POST /infer` returns `202 {task_id}`:

```json
{ "image_url": "https://example.com/desk.jpg",
  "boxes": [[0.1, 0.2, 0.5, 0.9]],
  "max_objects": 8, "seed": 42 }
```

| Field | Meaning |
|---|---|
| `image_url` | Public https photo (SSRF-checked). |
| `mask_urls` or `boxes` | Exactly one. Masks are https PNGs, white is the object. Boxes are `[x0, y0, x1, y1]` fractions of the frame, origin top-left, turned into masks with GrabCut. |
| `max_objects` | 1 to 12, default 8. Slivers (under 4% of a side or 0.2% of the frame) are rejected. |
| `seed` | 0 to 4294967295. |

Bad requests are `422` from `request_policy.py`. A task that finishes holds
`result_gcs_url`, `objects` (name, position, size per node) and `skipped`
(objects that failed individually). It fails only if every object fails.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `API_KEY` | required | Bearer secret, from Secret Manager `avatar-reconstruction-key`. |
| `GCS_BUCKET` | unset | Upload to `raw-meshes/sam3d-objects/{task}.glb`; otherwise serve from `OUTPUT_DIR`. |
| `WEIGHTS_ROOT` | `/weights/sam3d-objects` | Mounted weights; `entrypoint.sh` copies `hf/` to `/app/checkpoints/hf`. |
| `SAM3D_CHECKPOINT_DIR`, `SAM3D_SRC` | image paths | Checkpoints and the pinned upstream checkout. |
| `MAX_CONCURRENT` | `1` | Simultaneous reconstructions per instance. |
| `MODEL_LOAD_ATTEMPTS`, `MODEL_LOAD_RETRY_BASE_S`, `MODEL_LOAD_RETRY_CAP_S` | `4`, `15`, `120` | Load retry policy. |
| `IMAGE_FETCH_TIMEOUT_S` | `60` | Photo and mask fetch timeout. |

## Tests

`python -m pytest test_request_policy.py test_scene_layout.py test_app_contract.py`
(the Dockerfile runs them as a build gate). They cover request validation, the pose
math, mask handling, scene assembly and the HTTP contract with a stub pipeline.
`worker_security.py` is vendored; `npm run check:vendored` keeps it identical.

## Not verified without a GPU and the weights

The image build, a real model run, and the pose orientation (checked against
upstream source only) have not been exercised. Whether `pipeline.yaml` pulls an
auxiliary depth model from Hugging Face at first load is not visible without the
gated file, so the container is not run offline and the first load may need HF
egress. Cloud Run availability of the GPU class in the chosen region is also
unconfirmed.

## License

SAM License, see the LICENSE copied beside the weights. Use must comply with
Trade Controls; the platform endpoint refuses requests from comprehensively
sanctioned territories before queueing.
