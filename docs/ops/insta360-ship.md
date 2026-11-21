# Insta360 and 360 capture: ship runbook

How the three 360 lanes reach production, how to roll each one back, what a capture costs, and which quotas bound them. The command is `npm run ship:insta360` ([scripts/ship-insta360.mjs](../../scripts/ship-insta360.mjs)); the images it deploys are pinned in [deploy/insta360/images.json](../../deploy/insta360/images.json) (format in [deploy/insta360/README.md](../../deploy/insta360/README.md)). The worker contract is [prompts/finish/_context/insta360-00-CONTEXT.md](../../prompts/finish/_context/insta360-00-CONTEXT.md) (C1 to C5).

| Lane | Worker (Cloud Run) | API route | Page |
| --- | --- | --- | --- |
| Splat from 360 video, photos or `.insv` | `model-pano2splat` | `/api/pano-capture` | `/capture` (360 tab) |
| Depth scene from one 360 photo or `.insp` | `model-panodepth` (+ `model-pano2splat` to stitch an `.insp`) | `/api/pano-scene` | `/pano-scene` |
| Motion from a 360 clip | `model-video2motion` (equirect mode) | `/api/motion-swap` | `/video-to-motion` |

## Order of operations

1. `git push threews main` (owner).
2. `npm run ship:insta360 -- --dry-run`. Read-only: it checks every digest in `images.json` exists, picks the GPU region from live L4 quota minus warm pins, prints every `gcloud` command and the current `three-ws-api` values it would change, and probes each production route with an unauthenticated GET.
3. `npm run ship:insta360`. Deploys the two GPU workers, rolls `model-video2motion` to its verified image, waits for `/health` (`ok` and `gpu_available`; `weights_present` on panodepth), then runs `gcloud run services update three-ws-api --update-env-vars GCP_PANO2SPLAT_URL=...,GCP_PANODEPTH_URL=...`. `--update-env-vars` adds or replaces only those two keys; never use `--set-env-vars`, which replaces the whole set. `GCP_RECONSTRUCTION_KEY` is already on the API and the workers read the same secret (`avatar-reconstruction-key`) as `API_KEY`.
4. `npm run deploy:gcp:full` (owner, the normal API deploy) so the API routes and pages ship.
5. `npm run ship:insta360 -- --verify-only`. One authenticated preview job per lane through `https://three.ws` on a public Wikimedia Commons fixture; prints a pass or fail line per lane with the artifact URLs. Needs `THREE_WS_API_KEY` (an `sk_live_` key of a real account) in the environment.

The script never pushes git and never runs `deploy:gcp:full`. Run before step 4, its lane checks report `deferred` for any route the live API does not have yet; that is expected, and step 5 closes it.

Flags: `--dry-run`, `--verify-only`, `--skip-verify`, `--region <europe-west4|us-central1>`.

## Service shape

Both GPU workers run on one NVIDIA L4 with 8 vCPU and 32 GiB, `--min-instances=0 --max-instances=1 --concurrency=8 --no-cpu-throttling`, runtime service account `three-ws@`, results in `gs://three-ws-pano-captures` behind V4 signed URLs. Max 1 instance is deliberate: each worker holds its task table in process memory and trains one job at a time from its own queue (`MAX_QUEUE=8` on pano2splat), so a poll must land on the instance that owns the task. A second instance would answer 404 for it; the API turns a worker 404 into `task_lost` ("The capture worker restarted and lost this job. Start it again.") and a full queue (worker 429) into `503` with `retry-after: 120`, leaving no job row behind.

## Rollback

Each lane rolls back on its own. The API answers `503 unconfigured` with a clear message for a lane whose worker URL is unset, so removing a URL is always a safe stop.

**Stop a lane without touching the worker** (fastest, seconds):

```bash
gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 \
  --remove-env-vars GCP_PANO2SPLAT_URL      # or GCP_PANODEPTH_URL
```

`--remove-env-vars` drops only the named key. Removing `GCP_PANO2SPLAT_URL` also stops `.insp` stitching on `/pano-scene`; plain JPEG and PNG scenes keep working.

**Roll a worker back to its previous revision** (pano2splat, panodepth or video2motion):

```bash
REGION=europe-west4   # the region the dry run chose; video2motion is us-central1
SVC=model-pano2splat  # or model-panodepth, model-video2motion
gcloud run revisions list --service $SVC --region $REGION --project aerial-vehicle-466722-p5 --limit 5
gcloud run services update-traffic $SVC --region $REGION --project aerial-vehicle-466722-p5 \
  --to-revisions <previous-revision>=100
```

On the first ship, pano2splat and panodepth have no previous revision; stop the lane with `--remove-env-vars` instead, then delete the service if it should not stay (`gcloud run services delete $SVC --region $REGION`). video2motion always has one: its equirect mode is additive, and the previous revision keeps serving perspective clips.

**Undo the API env change entirely:** the script prints the previous value of each variable before it changes anything (step 5 of its output). Restore with `--update-env-vars NAME=<previous>` or `--remove-env-vars NAME` when it was unset.

## Cost per capture

Cloud Run bills a GPU instance for the whole time it is up: one L4 ($0.0001867/s) plus 8 vCPU and 32 GiB, about $0.000395/s ($1.42/hour) at list price, from the GCP Cloud Billing catalog on 2026-11-21. With min 0 nothing is billed while idle; each burst adds a cold start and up to 15 minutes of idle tail before the instance stops. Prices are paid from the GCP credits (see [docs/ops/gcp-credits-plan.md](gcp-credits-plan.md)).

Measured on one L4 in europe-west4 (Cloud Run Job `splat-train-measure`, run `20261121T222338Z`, harness [scripts/pano2splat-splat-train-gpu/](../../scripts/pano2splat-splat-train-gpu/)):

| Scene | Preset | Images | Train wall | Gaussians | Holdout PSNR | Instance cost |
| --- | --- | --- | --- | --- | --- | --- |
| garden (Mip-NeRF 360) | preview, 7000 iterations | 185 at 1600 px | 1062 s | 3.00 M | 26.46 dB | $0.42 |

The full capture adds stitch (raw `.insv` only) and SfM time on top of training; the end-to-end figures per fixture are in [Verify results](#verify-results).

## Quotas

| Quota | Where it binds | Value on 2026-11-21 |
| --- | --- | --- |
| Cloud Run L4 (`nvidia_l4_gpu_allocation_no_zonal_redundancy`) | both GPU workers need one each | europe-west4: 8 with 1 held warm (7 free); us-central1: 3, all held by warm production pins |
| Instances per worker | jobs queue, never fan out | max 1 by design; `MAX_QUEUE=8` on pano2splat, extra requests get `503` with `retry-after` |
| Capture uploads (`/api/capture-upload`) | per account | 3 open multipart uploads, 32 GiB per day, 8 GiB per file |
| Compute Engine L4 | only for manual test VMs, not the services | 8 per region; zones stock out often, so test on Cloud Run Jobs instead |

The script picks europe-west4 first and falls back to us-central1 only when europe-west4 lacks room for both workers; it fails with the numbers when neither has room. `--region` overrides the choice.

## Verify results

The GPU verify run builds the production image from `main` and runs [workers/model-pano2splat/verify.py](../../workers/model-pano2splat/verify.py) as the Cloud Run Job `pano2splat-verify` over every fixture in [workers/model-pano2splat/fixtures/MANIFEST.md](../../workers/model-pano2splat/fixtures/MANIFEST.md). Only an image that passes it goes into `images.json`.
