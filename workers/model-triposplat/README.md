# model-triposplat

One image in, one 3D Gaussian splat out. Wraps [VAST-AI-Research/TripoSplat](https://github.com/VAST-AI-Research/TripoSplat) (MIT code and weights, LICENSE read 2026-10-12). It is the Forge "Image to splat" lane behind `POST /api/forge-splat`, and its output opens directly in the Splat Viewer (`/splat?src=...`, Spark).

## Contract

| Call | Body / response |
|---|---|
| `POST /infer` | `{ images: [data-uri \| https url], num_gaussians?: 8192..262144 }` -> `202 { task_id, status }`. Only the first image is used. |
| `GET /tasks/:id` | `{ task_id, status, splat_url?, ply_url?, result_gcs_url?, num_gaussians?, elapsed_ms?, error?, error_kind? }` |
| `GET /health` | `503` with `ok:false` once model load has spent its retry budget. |
| `GET /` | Unauthenticated descriptor for the warmth probe. |

All calls except `/` and `/health` need `Authorization: Bearer $API_KEY`. Image URLs go through the SSRF-hardened fetcher in `worker_security.py` (https only, private ranges refused). Task state is persisted to GCS so a poll can land on any instance. `num_gaussians` defaults to 131072; upstream's ceiling is 262144.

## Environment

| Var | Purpose |
|---|---|
| `API_KEY` | shared bearer secret (`avatar-reconstruction-key`) |
| `GCS_BUCKET` | output bucket (results under `raw-splats/triposplat/`) |
| `WEIGHTS_DIR` | default `/weights/triposplat` |
| `MAX_CONCURRENT` | default 1 (L4, 24 GB) |

## Deploy

Stage weights once with `./stage-assets.sh` (copies `VAST-AI/TripoSplat` from Hugging Face to `gs://three-ws-model-weights/triposplat`), then build and deploy with `gcloud builds submit --config workers/model-triposplat/cloudbuild.yaml` (owner-gated production deploy). Point the API at it with `MODEL_TRIPOSPLAT_URL` plus the shared `GCP_RECONSTRUCTION_KEY`.

## Tests

`python test_splat_prep.py` (pure input/density/naming path; also gates the Docker build). API side: `tests/api/forge-splat.test.js`, `tests/api/gcp-triposplat-provider.test.js`.
