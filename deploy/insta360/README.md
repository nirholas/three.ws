# deploy/insta360

The images that `npm run ship:insta360` ([scripts/ship-insta360.mjs](../../scripts/ship-insta360.mjs)) puts into production for the Insta360 and 360 capture lanes. The full runbook (order of operations, rollback per service, measured cost per capture, quotas) is [docs/ops/insta360-ship.md](../../docs/ops/insta360-ship.md).

## What the script does

| Step | Change | Read-only in `--dry-run` |
| --- | --- | --- |
| 1 | Confirms every digest in `images.json` exists in Artifact Registry | yes |
| 2 | Picks the GPU region from live L4 quota minus warm pins held by other services (europe-west4 first, then us-central1) | yes |
| 3 | `gcloud run deploy model-pano2splat` and `model-panodepth` (1 L4, min 0, max 1, HTTP concurrency 8, runtime SA `three-ws@`, `API_KEY` from `avatar-reconstruction-key`); `gcloud run services update model-video2motion --image` | printed, not run |
| 4 | Waits for `/health`: `ok` and `gpu_available` on both GPU workers, `weights_present` on panodepth | printed |
| 5 | `gcloud run services update three-ws-api --update-env-vars GCP_PANO2SPLAT_URL=...,GCP_PANODEPTH_URL=...` (never `--set-env-vars`) | current values shown, change printed |
| 6 | One authenticated preview job per lane through `https://three.ws` on a public Wikimedia Commons fixture (`/api/pano-capture`, `/api/pano-scene`, `/api/motion-swap` in equirect mode) | an unauthenticated GET reports whether each route is deployed |

It never pushes git and never runs `npm run deploy:gcp:full`. When the production API predates the campaign, step 6 reports the lane as `deferred`; run `npm run ship:insta360 -- --verify-only` after `deploy:gcp:full`.

Flags: `--dry-run`, `--verify-only`, `--skip-verify`, `--region <europe-west4|us-central1>`.

Why max 1 instance: each worker keeps its task table in process memory and runs one GPU job at a time from its own queue. A second instance would answer 404 for a task it does not own, so polls must stay on one instance. HTTP concurrency 8 lets status polls through while a job trains.

## images.json

One entry per service. Only digests that passed the GPU verify run go here; the script refuses tags and images from any other repository.

```json
{
	"pano2splat": {
		"image": "us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/model-pano2splat/server@sha256:<64 hex>",
		"source_commit": "<git sha the image was built from>",
		"verified": "<date and verify run, e.g. Cloud Run Job execution name>"
	},
	"panodepth": { "image": "<region>-docker.pkg.dev/aerial-vehicle-466722-p5/model-panodepth/server@sha256:<64 hex>" },
	"video2motion": { "image": "us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/model-video2motion/server@sha256:<64 hex>" }
}
```

A GPU image may be built in us-central1 or europe-west4 (next to the GPUs that run it). A real run stops when any service has no entry; a dry run names the missing ones and plans the rest.

The plan logic lives in [scripts/lib/insta360-ship-plan.mjs](../../scripts/lib/insta360-ship-plan.mjs) and is covered by [tests/ship-insta360-plan.test.js](../../tests/ship-insta360-plan.test.js).
