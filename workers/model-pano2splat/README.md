# model-pano2splat

GPU worker that turns 360 capture (raw Insta360 .insv/.insp or ready equirect video or photos) into a Gaussian splat.

Stages, each a Python package with its own README and a CLI run by `pipeline.py`:

- [pano_stitch/](pano_stitch/README.md): raw Insta360 files to level equirect video or photo (`python -m pano_stitch`).
- [pano_sfm/](pano_sfm): structure from motion on equirect frames.
- [splat_train/](splat_train): Gaussian splat training.

Service shell: `main.py` (HTTP entry), `health.py`, `stages.py`, `results.py`, `source_fetch.py`, `worker_security.py`. One GPU image is built by `Dockerfile` through `cloudbuild.yaml`; `cloudbuild.verify.yaml` and `verify.py` prove it. Per-stage Python pins live in `requirements.d/`, test footage manifest in `fixtures/MANIFEST.md`, tests in `tests/`.

## Service API (contract C1)

`POST /infer` (bearer `API_KEY`) queues a task and returns `{task_id}`. `GET /tasks/{id}` returns status, progress, stage, queue position and, when done, signed result URLs (7-day V4). `DELETE /tasks/{id}` cancels (the stage's whole process group is terminated). `GET /health` reports GPU, COLMAP, gsplat, ffmpeg NVENC and per-stage import status. Source URLs are fetched SSRF-safe with magic-byte sniffing per `source_kind`. One task runs at a time; up to `MAX_QUEUE` (8) wait, then 429 `busy`. Task manifests persist at `gs://$RESULT_BUCKET/<task_id>/task.json`, so a restarted instance reports `worker_lost` instead of losing the task.

Env: `API_KEY` (secret), `RESULT_BUCKET` (default `three-ws-pano-captures`), `MAX_SOURCE_BYTES`, `MAX_QUEUE`, `SIGNING_SA` (override), `STAGE_TIMEOUT_<MODULE>_S`, `STAGE_VENVS_DIR` (default `/opt/stages`). Signing needs `roles/iam.serviceAccountTokenCreator` on the runtime service account over itself.

## Image

Three stages: COLMAP 4.2.1 compiled with CUDA (cached as `colmap-build:cache`), a Python build stage, and a CUDA runtime. Each `requirements.d/<stage>.txt` gets its own venv in `/opt/stages/<stage>` because the stage pins conflict (numpy 1 vs 2, opencv 4 vs 5); torch comes from `/opt/venv` through a `.pth`. gsplat 1.5.3 is compiled in the build stage (no cp312 wheel). Measured: 7.84 GB compressed (`sha256:42010f45...`, the first verified build). `/tmp` is RAM-backed on Cloud Run, so `WORK_DIR` must be an in-memory-sized volume or the instance memory must cover the working set.

## Rebuild and verify (one command)

```
TMPDIR=/home/user/.cache/gcloud-tmp gcloud builds submit workers/model-pano2splat \
  --config workers/model-pano2splat/cloudbuild.verify.yaml --region us-central1 \
  --project aerial-vehicle-466722-p5 [--substitutions _JOB_REGION=europe-west4,_ONLY=<ids>,_QUALITY=preview]
```

It builds and pushes the image, updates the GPU Cloud Run Job `pano2splat-verify` and runs `verify.py` over every `verify: true` entry of `gs://three-ws-capture-fixtures/insta360/MANIFEST.json`. The report lands in `gs://three-ws-pano-captures/verify-<date>/verify-report.json`. L4 quota is 8 in europe-west1, europe-west4 and asia-southeast1 (3 in us-central1).

## Deploy command (order 347 runs it)

```
gcloud run deploy model-pano2splat --project aerial-vehicle-466722-p5 --region europe-west1 \
  --image us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/model-pano2splat/server@<verified digest> \
  --service-account three-ws@aerial-vehicle-466722-p5.iam.gserviceaccount.com \
  --gpu 1 --gpu-type nvidia-l4 --no-gpu-zonal-redundancy --cpu 8 --memory 32Gi --no-cpu-throttling \
  --concurrency 8 --min-instances 0 --max-instances 8 --timeout 3600 \
  --set-secrets API_KEY=avatar-reconstruction-key:latest --update-env-vars RESULT_BUCKET=three-ws-pano-captures
```

Concurrency is 8 on purpose: polls must be served while a task runs, and the in-process queue serialises the GPU work.
