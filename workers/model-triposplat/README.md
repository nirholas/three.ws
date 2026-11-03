# model-triposplat

One image in, one 3D Gaussian splat out. Wraps [VAST-AI-Research/TripoSplat](https://github.com/VAST-AI-Research/TripoSplat) (MIT code and weights, LICENSE read 2026-10-12). It is the Forge "Image to splat" lane behind `POST /api/forge-splat`, and its output opens directly in the Splat Viewer (`/splat?src=...`, Spark).

## Contract

| Call | Body / response |
|---|---|
| `POST /infer` | `{ images: [data-uri \| https url], num_gaussians?: 32768..262144 }` -> `202 { task_id, status }`. Only the first image is used. |
| `GET /tasks/:id` | `{ task_id, status, splat_url?, ply_url?, result_gcs_url?, num_gaussians?, elapsed_ms?, error?, error_kind? }` |
| `GET /health` | `503` with `ok:false` once model load has spent its retry budget. |
| `GET /` | Unauthenticated descriptor for the warmth probe. |

All calls except `/` and `/health` need `Authorization: Bearer $API_KEY`. Image URLs go through the SSRF-hardened fetcher in `worker_security.py` (https only, private ranges refused). Task state is persisted to GCS so a poll can land on any instance. `num_gaussians` defaults to 131072; upstream's pipeline asserts 32768 to 262144, so both this worker and the API refuse counts outside that range as input errors.

## Environment

| Var | Purpose |
|---|---|
| `API_KEY` | shared bearer secret (`avatar-reconstruction-key`) |
| `GCS_BUCKET` | output bucket (results under `raw-splats/triposplat/`) |
| `WEIGHTS_BUCKET` / `WEIGHTS_PREFIX` | where the checkpoints live, default `three-ws-model-weights` / `triposplat` |
| `LOCAL_WEIGHTS_DIR` | boot-time staging dir, default `/tmp/triposplat-weights` |
| `MAX_CONCURRENT` | default 1 (L4, 24 GB) |

## Cold start

At boot the five checkpoints (about 4.2 GB) are downloaded from GCS in parallel to local disk, loaded onto the GPU, then deleted to free the RAM-backed disk. They are deliberately not read through a gcsfuse volume: safetensors reads each file out of order, and over the mount the first deploy's cold instance was still loading after 17 minutes. `/health` reports `ready: true` once the pipeline is on the GPU; jobs submitted before that queue and start when it lands.

## Deploy

Stage weights once with `./stage-assets.sh` (copies `VAST-AI/TripoSplat` from Hugging Face to `gs://three-ws-model-weights/triposplat`), then build and deploy with `gcloud builds submit --config workers/model-triposplat/cloudbuild.yaml` (runs as the `three-ws-build@` service account and pushes to the `model-triposplat` Artifact Registry repo). Deployed 2026-11-03 as the `model-triposplat` Cloud Run service (L4, us-central1). Point the API at it with `MODEL_TRIPOSPLAT_URL` plus the shared `GCP_RECONSTRUCTION_KEY`.

## Tests

`python test_splat_prep.py` (pure input/density/naming path; also gates the Docker build). API side: `tests/api/forge-splat.test.js`, `tests/api/gcp-triposplat-provider.test.js`.
