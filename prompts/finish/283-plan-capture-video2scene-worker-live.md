# Scene Capture (/capture) runs on a live video2scene GPU worker instead of its 503 sample-cloud state

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/283-plan-capture-video2scene-worker-live.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 55 of 100 inside the tier). **Area:** capture. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

`/capture` (video to 3D point cloud) and the MCP studio scene-capture tool are fully built on the API side, but the GPU worker `workers/model-video2scene` (LingBot-Map on an L4) is not deployed as a Cloud Run service and `GCP_VIDEO2SCENE_URL` is unset on the API, so every real request hits the designed `503` unconfigured path and the page falls back to its built-in sample cloud. The weights are already staged in `gs://three-ws-model-weights`. This is a finished feature whose only gap is the last mile: verified build, deploy, env wiring and an end-to-end check.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Worker code complete: `workers/model-video2scene/{main.py,scene_fusion.py,test_scene_fusion.py,worker_security.py,Dockerfile,cloudbuild.yaml}`; README says "Not currently deployed as its own Cloud Run service".
- API wiring present and env-gated: `api/scene-capture.js` (message: "Set GCP_VIDEO2SCENE_URL and GCP_RECONSTRUCTION_KEY"), `api/_providers/gcp.js` (`video2scene -> GCP_VIDEO2SCENE_URL`), `api/_lib/x402/scene-capture-processor.js`, `api/_mcp3d/tools/studio.js`.
- `gcloud run services list` showed no `model-video2scene` service on 2026-11-03; `gsutil ls gs://three-ws-model-weights` shows the lingbot-map weights staged.
- `cloudbuild.yaml` pins `three-ws-build@` and runs as `avatar-reconstruction-sa@`, GPU `nvidia-l4`, 0 to 2 instances.
- Page: `pages/capture.html` served at `/capture`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
gcloud run services list --region us-central1 --project aerial-vehicle-466722-p5 --format='value(metadata.name)' | grep -i video2scene
gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format=json | grep -c GCP_VIDEO2SCENE_URL
gsutil ls gs://three-ws-model-weights | grep -i lingbot
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://three.ws/api/scene-capture -H 'content-type: application/json' -d '{}'
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Run the worker's real tests locally: `cd workers/model-video2scene && python -m pytest test_scene_fusion.py` (the README documents the CPU-only fusion + PLY path). Fix anything that fails; do not skip tests.
2. Build the image locally the way the README does (the Docker build reruns the tests and imports the module) to prove the image builds before spending cloud build time. Fix any import or dependency failure at the root cause.
3. Run the vendored-module check (`npm run check:vendored`) because `worker_security.py` is a shared module vendored per worker; confirm it is byte-identical.
4. Verify `cloudbuild.yaml` against the current project: service accounts exist (`avatar-reconstruction-sa@`, `three-ws-build@`), the Artifact Registry repo `model-video2scene` exists (create it with `gcloud artifacts repositories create` if missing: `three-ws-build@` cannot), the weights bucket mount path matches the weights loader, and L4 GPU quota in `us-central1` is available (read the live quota, do not trust docs).
5. Deploy: this is the routine production-deploy gate. Prepare the exact command from the README (`gcloud builds submit --config workers/model-video2scene/cloudbuild.yaml . --region us-central1 --project aerial-vehicle-466722-p5 --substitutions=SHORT_SHA=manual$(date +%s)`) and run it if the owner's current instruction approves production deploys; otherwise stop with it ready.
6. After the service is live: `gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --update-env-vars GCP_VIDEO2SCENE_URL=<service-url>` (never `--set-env-vars`). Confirm `GCP_RECONSTRUCTION_KEY` is already present and equals the bearer the worker checks.
7. End-to-end: upload a short real clip on `/capture` in a browser, confirm a real point cloud (not the sample cloud) renders, the job status polls to completion, and the result downloads. Capture the worker logs for the request. Also call the MCP studio scene-capture tool once.
8. Update `workers/model-video2scene/README.md` Deploy section (service URL, observed cold-start and per-clip latency), `STRUCTURE.md` status row, `data/changelog.json` entry, `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `python -m pytest workers/model-video2scene/test_scene_fusion.py` passes.
- [ ] `gcloud run services describe model-video2scene --region us-central1 --project aerial-vehicle-466722-p5 --format='value(status.url)'` prints a URL, and `gcloud run services describe three-ws-api ... --format=json | grep GCP_VIDEO2SCENE_URL` matches.
- [ ] `/capture` with a real clip renders a worker-produced point cloud; the 503 unconfigured state no longer appears (observed in a browser, no console errors).
- [ ] `npm run check:vendored` passes.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| L4 GPU quota looks exhausted | Read the live quota; try another L4 region only with `--update-env-vars` pointing at it, or reduce `_MAX_INSTANCES`; GCP credits are pre-approved for GPU workers. |
| Artifact Registry repo missing | Create it with `gcloud artifacts repositories create model-video2scene --repository-format=docker --location=us-central1` as the project owner identity. |
| Cold start too slow for a 120s HTTP timeout | Set `_MIN_INSTANCES=1` for the first rollout and record the measurement; credits are pre-approved. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/283-plan-capture-video2scene-worker-live.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `283-plan-capture-video2scene-worker-live.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `workers/model-video2scene/README.md` (whole file)

~~~~markdown
# model-video2scene

Streaming **video to 3D point-cloud** reconstruction on Cloud Run GPU.

Wraps [LingBot-Map](https://github.com/Robbyant/lingbot-map) (Apache-2.0), a
feed-forward "Geometric Context Transformer" that reconstructs a dense
world-space point cloud from a monocular video or image sequence using
paged-KV-cache attention (FlashInfer).

The worker drives the upstream repo's own entry points (`demo.load_images`,
`demo.load_model`, `demo.postprocess`), unprojects the predicted depth with the
predicted camera to get world-space points, optionally removes sky pixels with
LingBot-Map's sky segmentation, fuses those points with their per-pixel RGB into
a single coloured cloud, writes a binary PLY, and uploads it to Cloud Storage. The
three.ws **Scene Capture** page (`/capture`) renders that PLY directly in a
WebGL point-cloud viewer ([`src/pointcloud-viewer.js`](../../src/pointcloud-viewer.js)).

## API

```
POST /infer        { video_url | images[], mode?, fps?, keyframe_interval?, ... }  -> 202 { task_id }
GET  /tasks/:id    -> { status, result_gcs_url?, num_points?, frames?, bytes?, error? }
GET  /health       -> { ok, gpu_available, model_loaded, weights_present, max_frames }
```

Bearer auth on `/infer` and `/tasks/:id` (`Authorization: Bearer $API_KEY`). The
three.ws API ([`api/scene-capture.js`](../../api/scene-capture.js)) holds the
matching `GCP_RECONSTRUCTION_KEY` and points at `GCP_VIDEO2SCENE_URL`.

### Request fields

| Field | Default | Meaning |
|---|---|---|
| `video_url` | none | Public https URL to an `.mp4` / `.mov` / `.webm`. One of `video_url` or `images[]` is required. |
| `images[]` | none | Frames as https URLs or `data:image` URIs, in order. |
| `mode` | `streaming` | `streaming` (one pass, KV cache) or `windowed` (independent windows, aligned across overlaps). Each mode is a different upstream model class, so switching modes reloads the checkpoint. |
| `fps` | `8` | Frames per second sampled from the video. |
| `keyframe_interval` | `4` | Every N-th frame after the scale frames keeps its KV in cache. Higher means less memory, less detail. |
| `num_scale_frames` | `8` | Leading frames processed bidirectionally to fix scale. Baked into the model build, so changing it also reloads the checkpoint. |
| `window_size` / `overlap_size` | `128` / `16` | Windowed mode only. |
| `mask_sky` | `true` | Runs LingBot-Map sky segmentation and drops sky pixels. |
| `conf_percentile` | `30` | Drops the lowest N percent of surviving points by model confidence. |
| `max_points` | `1500000` | Hard cap after fusion (deterministic stride subsample). |
| `voxel_size` | `0` | World-unit voxel edge. Above 0, points sharing a cell are merged and colour-averaged before the cap, which de-duplicates re-observed surfaces. |
| `job_id` | none | Caller correlation id, echoed in logs. |

A finished task also reports `frames_truncated` and `sky_points_removed`.

### Where the geometry comes from

The released checkpoints have no point head: `GCTStream` is built with
`enable_point=False`, so inference returns `depth` and `depth_conf` and never a
`world_points` map. The cloud is therefore built by unprojecting each depth map
with the camera the model predicted for that frame, which is what LingBot-Map's
own viewer and GLB export do. The unprojector documents its extrinsic as
world-to-camera while `postprocess` hands back camera-to-world, so the worker
inverts before unprojecting; feeding it the wrong one puts the cloud somewhere
other than in front of the cameras. If a future checkpoint does ship a point
head, the worker uses its `world_points` directly.

### Frame budget

`MAX_FRAMES` (default 512) caps a single job. Fusion holds world points,
confidences and RGB for every pixel of every frame at once (about 12 MB per
518x518 frame), so 512 frames peaks near 10 GB of the instance's 32 GiB. At the
default `fps: 8` that is 64 seconds of video; longer clips should lower `fps`
rather than raise the cap. An input longer than the cap is truncated and the
task reports `frames_truncated: true`. `MAX_FRAME_NUM` (default 1024) is the
separate 3D RoPE budget the model is built with and bounds `MAX_FRAMES`.

## Model weights

Mounted read-only from the shared weights bucket at `WEIGHTS_DIR/MODEL_FILE`
(default `/weights/lingbot-map/lingbot-map-long.pt`), plus `skyseg.onnx` in the
same directory for sky masking. Both are already staged in
`gs://three-ws-model-weights/lingbot-map/`. To restage from scratch:

```bash
curl -L -o lingbot-map-long.pt https://huggingface.co/robbyant/lingbot-map/resolve/main/lingbot-map-long.pt
curl -L -o skyseg.onnx https://huggingface.co/JianyuanWang/skyseg/resolve/main/skyseg.onnx
gsutil -m cp lingbot-map-long.pt skyseg.onnx gs://three-ws-model-weights/lingbot-map/
```

The checkpoint is 4.6 GB and the sky model 168 MB. If `skyseg.onnx` is absent
from the mount the worker downloads it once into `SKYSEG_CACHE_DIR`
(`/tmp/skyseg`) so sky masking still works; the checkpoint has no such fallback
and `/infer` answers `503` until it is mounted.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `API_KEY` | required | Shared bearer secret (Cloud Run secret `avatar-reconstruction-key`). |
| `GCS_BUCKET` | required | Bucket for output point clouds (`three-ws-avatar-reconstructions`). |
| `WEIGHTS_DIR` | `/weights/lingbot-map` | Mounted weights directory. |
| `MODEL_FILE` | `lingbot-map-long.pt` | Checkpoint filename. |
| `SKYSEG_FILE` | `skyseg.onnx` | Sky-segmentation model filename. |
| `LINGBOT_DIR` | `/opt/lingbot-map` | Upstream checkout on `PYTHONPATH`. |
| `MAX_CONCURRENT` | `1` | Parallel reconstructions per instance. |
| `MAX_FRAMES` | `512` | Frame cap per job. |
| `MAX_FRAME_NUM` | `1024` | 3D RoPE frame budget used to build the model. |
| `USE_SDPA` | unset | Set to `1` to force PyTorch SDPA attention instead of FlashInfer. |

## Build and test

```bash
# Fusion + PLY core path, no GPU and no checkpoint needed.
cd workers/model-video2scene && python -m unittest test_scene_fusion

# The image the deploy ships. The build reruns those tests and imports the
# service module, so a broken fusion path or import fails the build.
docker build -t model-video2scene:local workers/model-video2scene
```

Run it locally against real weights (CPU works but is slow; FlashInfer needs a
GPU, so the worker falls back to SDPA attention automatically):

```bash
docker run --rm -p 8080:8080 \
  -e API_KEY=local -e GCS_BUCKET=three-ws-avatar-reconstructions \
  -v /path/to/weights:/weights/lingbot-map:ro \
  model-video2scene:local
curl -s localhost:8080/health
```

The Cloud Storage client binds on first upload, not at startup, so the service
boots, loads the checkpoint and answers `/health` without credentials. Only the
upload at the end of a job needs them: add
`-v $HOME/.config/gcloud:/root/.config/gcloud:ro` after
`gcloud auth application-default login` to finish a job locally.

## Deploy

Not currently deployed as its own Cloud Run service. Deploying it is one
command, and it must be run by the repo owner:

```bash
gcloud builds submit --config workers/model-video2scene/cloudbuild.yaml . \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s)
```

The config builds, pushes, and deploys the `model-video2scene` service on an
NVIDIA L4 with the weights bucket mounted at `/weights`. Afterwards set
`GCP_VIDEO2SCENE_URL` to the service URL on the three.ws API service
(`gcloud run services update three-ws-api --region us-central1
--update-env-vars GCP_VIDEO2SCENE_URL=...`). `GCP_RECONSTRUCTION_KEY` is already
shared across the model workers. Until then `/capture` returns its designed
`503` unconfigured state and renders its built-in sample cloud.

## Hardware

NVIDIA L4 (CUDA 12.8), 8 vCPU / 32 GiB. Frames stay in host RAM and are moved to
the GPU one window at a time, so peak VRAM tracks the window, not the clip. For
long clips, lower `fps`, raise `keyframe_interval`, or use `mode: "windowed"`
with a smaller `window_size`.
~~~~

