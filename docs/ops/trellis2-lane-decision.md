# TRELLIS.2 lane: why it serves nothing, and what it takes to serve it

Owner decision record, written 2026-11-26 (Forge hardening 16). Nothing in it has been deployed or switched. The working image lane, `trellis_selfhost`, is protected (see [forge-protected-lanes.md](./forge-protected-lanes.md)) and nothing here moves traffic off it.

## The cause, in one sentence

`trellis2` serves nothing because `MODEL_TRELLIS2_URL` has never been set on the production API service, so `backendIsConfigured('trellis2')` is false and every router drops the lane before any network call, leaving `trellis_selfhost` to serve every photo.

## Evidence (2026-11-26)

- **Lane stats, 7 days** (`npm run forge:lanes`): `trellis_selfhost` 914 done and 46 failed, 95.2%, protected. `trellis2` 0 jobs. `triposg` 46.9% and `pixal3d` 18.2% (both open). `trellis_nvcf` and `hunyuan3d` 0 jobs.
- **Production health** (`GET /api/forge?health=1`): `trellis2` reports `unconfigured`, "The TRELLIS.2 (self-host) worker is not configured on this deployment."
- **Env on `three-ws-api`**: neither the serving project (`three-ws`) nor the old project (`aerial-vehicle-466722-p5`) has `MODEL_TRELLIS2_URL`. Both have `MODEL_TRELLIS_URL`, `FORGE_SELFHOST_PRIMARY=1` and `GCP_RECONSTRUCTION_KEY`.
- **Routing** (`api/_lib/forge-tiers.js`): `trellis2.requiresEnv` is `['MODEL_TRELLIS2_URL', 'GCP_RECONSTRUCTION_KEY']`. `FREE_DEFAULT_FOR_TIERS` names `trellis2` for every tier and `FREE_FALLBACK_FOR_PATH.image` lists it first, but `freeLaneCandidates` filters on `freeLaneUsable`, which requires the env. Failover, redispatch, suggestions, the health probe and the keep-warm cron all check the same env first.
- **Database (read-only)**: four `trellis2` rows ever, all lab runs on 2026-11-11. Two draft (512) jobs finished with 48 to 50 s of GPU time. Two standard jobs failed with "task orphaned: its runner instance stopped mid-job (restart or out of memory)".
- **Worker logs**: on the current image (`server:2dff87f51`), a 512 job on 2026-11-20 finished in 104.6 s with a peak of 27.1 of 32 GiB host memory (decode 26.8, `to_glb` 27.1). The instance holds 16.9 GiB right after load. 1024 and 1536 finish sampling and are then killed with signal 9 in decode and `to_glb`.

The skip costs nothing: [tests/api/forge-trellis2-unconfigured.test.js](../../tests/api/forge-trellis2-unconfigured.test.js) drives a photo through both forge handlers with the real gcp provider and proves the only worker call is the TRELLIS `/infer`, with no request to a TRELLIS.2 host and no wait.

## Why leaving it unset was right

The worker that existed until today would have taken the `standard`, `high` and `max` tiers at 1024 or 1536 on a 32 GiB host and been killed every time. Setting the URL would have made it first choice for every photo, and each of those jobs would have cost the user minutes before failover. Since commit 6baac1139 the worker reads its own memory limit and serves at most 512 on a host with 32 GiB or less (`request_policy.HOST_RAM_KILLED_AT_GIB`); that fix is committed but not deployed.

## What it takes to deploy

1. Build and deploy the fixed worker image with the Deploy section of [workers/model-trellis2/README.md](../../workers/model-trellis2/README.md) (`gcloud builds submit --config workers/model-trellis2/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5 --substitutions=SHORT_SHA=manual$(date +%s) .`, most of an hour on the 32-vCPU builder). The service already exists: `model-trellis2`, us-central1, project `aerial-vehicle-466722-p5`, 8 vCPU, 32 GiB, one L4, min 0, max 2. After the deploy, `GET /health` must list `"resolutions": [512]`.
2. A routing change before the URL is set (see the trial plan). Setting `MODEL_TRELLIS2_URL` alone puts `trellis2` ahead of the working lane for every photo.
3. Then `gcloud run services update three-ws-api --region us-central1 --update-env-vars MODEL_TRELLIS2_URL=<service url>` (never `--set-env-vars`, which replaces the whole env).

The worker lives in the old project while the API serves from `three-ws`. That works (the API calls it by URL with the shared bearer key), but the move-everything-to-`three-ws` goal means a redeploy there needs L4 quota in `three-ws` first.

## GPU, cost and cold start

Rates from the [Cloud Run pricing page](https://cloud.google.com/run/pricing), instance-based billing, no zonal redundancy. The GPU rates are as listed there. The CPU ($0.000018 per vCPU-second) and memory ($0.000002 per GiB-second) rates are the tier 1 list prices; recheck the page before budgeting. All of it draws on the GCP credits.

- **L4 shape (current, 8 vCPU, 32 GiB):** GPU $0.67, CPU $0.52, memory $0.23, about **$1.42 per instance-hour**. Serves 512 only.
- **RTX PRO 6000 shape (20 vCPU, 80 GiB, the minimum Cloud Run allows for that GPU, as `model-hunyuan3d-21-rtx` runs):** GPU $1.31, CPU $1.30, memory $0.58, about **$3.19 per instance-hour**. 80 GiB clears the measured 1024 and 1536 host-memory kill; it has not been run there yet.
- **Idle cost: zero.** Min instances stay 0 (owner spend cut of 2026-11-25). Never raise it without the owner's yes.
- **Per job on the L4:** a 512 job holds the instance for about 56 to 105 s, roughly $0.02 to $0.04. Cloud Run bills the whole instance lifecycle, so an idle tail after the last job is also billed until the instance scales down.
- **Cold start: about 6.5 to 7 minutes** (boot 21:38:36 to model loaded 21:45:09 on 2026-11-25; about 7 minutes on 2026-11-20, including Hugging Face Hub file lookups that failed once and then succeeded). The first job after idle pays it, roughly $0.16 of instance time and, more importantly, seven minutes of a user's wait.

## Quality gain

What TRELLIS.2 adds over the TRELLIS v1 worker that serves today: physically based materials (base colour with alpha, metallic-roughness and normal maps) instead of a baked colour texture, translucency handled per material, and a higher voxel resolution ceiling (1024 and 1536) on a host that can hold it. On the L4 shape the resolution gain is gone (512 only), so the gain there is materials and alpha, not geometric detail.

We have no head-to-head measurement on our own photos. The 512 runs produced about 290k triangles, a 2048 px texture with five maps, 3.6 to 3.7 MB. Do not claim a quality win until the trial below has compared the two lanes on the same inputs.

## Safe trial plan (never ahead of the working lane)

1. **Deploy the fixed image** (owner approval: it is a deploy). Verify `GET /health` lists only 512. No traffic reaches it yet because the URL is still unset on the API.
2. **Add an explicit-only gate** before setting the URL: a flag under which `trellis2` is served when a request names it (`backend: "trellis2"`, as the TRELLIS.2 Lab does) but is skipped by `freeLaneCandidates`, failover, redispatch and suggestions. This is a change to `api/_lib/forge-tiers.js` and `api/_lib/forge-failover.js`; it leaves `trellis_selfhost` first for every unnamed photo, and it needs a test that pins exactly that plus the owner's yes, because those lists hold a protected lane.
3. **Set the URL with the gate on.** Run the trial from the Lab only, on the same photos sent to `trellis_selfhost`, and compare the GLBs side by side.
4. **Measure** with `npm run forge:lanes`. The lane is unproven until it has 20 or more finished jobs at 85% or better over 7 days.
5. **Only then** consider making it a fallback behind `trellis_selfhost` (never ahead of it while that lane is protected). Moving it ahead is a separate owner decision backed by both the stats and the side-by-side comparison.
6. **Rollback at any step**: `gcloud run services update three-ws-api --region us-central1 --remove-env-vars MODEL_TRELLIS2_URL`. The lane is skipped again on the next request, and the test above pins that the skip is free.

For 1024 and 1536, either redeploy on the RTX PRO 6000 shape (the worker then lifts its own cap) or reduce the worker's resident host footprint so the L4 shape stops being killed.

## Leftover services

`model-trellis2-bench-1`, `-bench-2`, `-bench-3` (europe-west4, 2026-11-16) and `model-trellis2-lab` (europe-west1, 2026-11-11) still exist in `aerial-vehicle-466722-p5`, all min 0 and max 1, so they cost nothing while idle. Deleting them is the owner's call.
