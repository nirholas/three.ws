# LongCat video avatar worker runs on an 80GB GPU host with staged weights, an idle-stop lifecycle and API wiring

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/977-plan-avatar-longcat-gpu-host-bringup.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 40 of 100 inside the tier). **Area:** avatar. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The talking-video avatar worker (`workers/longcat`) is built, and the API side (`api/avatar/video-generate.js`, `api/avatar/video-status.js`, and the `videoAvatarEnabled` flag in `api/config.js`) is built, but `LONGCAT_WORKER_URL` is unset so the feature reports disabled and returns 503. The worker needs one 80 GB GPU (the 45 GB weight set does not fit an L4 or the 40 GB A100), which Cloud Run GPU (L4 only) cannot provide, so it needs a Compute Engine host (A100-80 or H100). The 44.81 GB of weights are not staged and the project's A100-80GB quota is 0, so nothing can start until a quota request is lodged and approved by Google. Almost everything else is agent-doable and can be finished now so that approval turns into a live capability with zero further engineering.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `workers/longcat/` contains `main.py`, `model_weights.py`, `inference_plan.py`, `worker_security.py`, `stage-weights.sh`, `check_pins.py`, `test_app_smoke.py`, `test_inference_plan.py`, `test_model_weights.py`, `cloudbuild.yaml`, `Dockerfile`, requirements files and a README ("Why this is not on Cloud Run", "Running it", "Prerequisites for a first deploy"). README names `a2-ultragpu-1g` or `a3-highgpu-1g` as the hosts and `LONGCAT_WORKER_URL` / `LONGCAT_WORKER_KEY` as the env that goes on three-ws-api (via `--update-env-vars`, never `--set-env-vars`).
- API side: `api/avatar/video-generate.js` (reads `LONGCAT_WORKER_URL`/`LONGCAT_WORKER_KEY` at line ~82, logs and 503s when unset at ~244), `api/avatar/video-status.js` (line ~47), and `api/config.js` (`videoAvatarEnabled = !!LONGCAT_WORKER_URL`, exposed as `videoAvatar`). `api/_providers/gcp.js` does NOT read the LongCat vars.
- Secret Manager already holds `longcat-video-avatar-key`; Firestore (default) in us-central1 and the Artifact Registry repo `longcat-video-avatar` were created 2026-08-11 per the README.
- Compute quota measured 2026-08-11 and re-checked 2026-11-03: `NVIDIA_A100_80GB_GPUS 0` in us-central1, no H100 metric. Weights for longcat are NOT in `gs://three-ws-model-weights` (lingbot-map is).
- No script manages the VM lifecycle (no `deploy-gce.sh`, no `scripts/` dir under `workers/longcat`), so a running 80GB GPU would bill continuously. `three-ws-api` does not have `LONGCAT_WORKER_URL` set.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
gcloud compute regions describe us-central1 --project aerial-vehicle-466722-p5 --format=json | python3 -c "import json,sys; [print(q['metric'],q['limit'],q['usage']) for q in json.load(sys.stdin)['quotas'] if 'A100' in q['metric'] or 'H100' in q['metric']]"
gcloud storage ls gs://three-ws-model-weights/ 2>&1 | grep -i longcat || echo "weights not staged"
gcloud secrets list --project aerial-vehicle-466722-p5 --format='value(name)' | grep longcat
gcloud compute instances list --project aerial-vehicle-466722-p5 --format='value(name,machineType)' | grep -i longcat
gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format=json | grep -c LONGCAT
curl -s https://three.ws/api/config | head -c 400
ls workers/longcat; grep -rn LONGCAT api --include=*.js | head
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Run the worker's CPU-safe tests: `cd workers/longcat && python -m pytest test_inference_plan.py test_model_weights.py test_app_smoke.py` and `python check_pins.py`. Fix failures at the root cause.
2. Quota: write `workers/longcat/scripts/request-quota.sh` that prints the exact `gcloud alpha services quota update` (or console deep link) for `NVIDIA_A100_80GB_GPUS` and `NVIDIA_H100_GPUS` in `us-central1` and `us-east4`, with the justification text for the Web3 grant, and submit the preference with `gcloud alpha quotas preferences create` where the API allows it. Also check Spot A100-80GB (`PREEMPTIBLE_NVIDIA_A100_80GB_GPUS`), which often has a non-zero default, and other zones/regions with H100 or A100-80 capacity (`a2-ultragpu-1g`, `a3-highgpu-1g`). Record the request id and quota status in the README.
3. Weights: run `workers/longcat/stage-weights.sh` from a Cloud Build or small CPU VM job (no GPU needed; background it and continue) so the 44.81 GB land in `gs://three-ws-model-weights/longcat/`; verify with `gcloud storage du`, check checksums against the `model_weights.py` expectations, and commit a checksum manifest as `workers/longcat/weights.sha256`.
4. Host provisioning: write `workers/longcat/deploy-gce.sh` (idempotent, no secrets in the file) that creates the instance with the right image, mounts or copies the weights, pulls the image from Artifact Registry, starts the container with `API_KEY` from Secret Manager, and installs a systemd unit with restart-on-failure. Limit access with a firewall rule to the API's egress, or put the host behind an authenticated HTTPS front (the worker already compares bearer tokens in constant time). Shellcheck-clean.
5. Lifecycle: add `workers/longcat/scripts/host.mjs` with `start`, `stop`, `status`, `ensure` subcommands over `gcloud compute instances`; `ensure` starts the VM if stopped and waits for `/health` to report `model_loaded: true`.
6. Idle stop: add a configurable idle-shutdown check on the host (no task for N minutes then `shutdown -h`), tested in `workers/longcat/tests/idle-shutdown.test.js` against a fake clock and a recorded task log. Never leave the host running unattended after verification without it.
7. Cost guard: add a hard daily GPU-hour cap that `ensure` honors, and the GCP-credit accounting line in `docs/ops/gcp-credits-plan.md`.
8. API wiring: make `api/avatar/video-generate.js` and `video-status.js` return a typed "capacity unavailable, retry" response (not a socket error) when the host is stopped and `ensure` has not completed. Add `tests/longcat-provider.test.js` covering the configured, unconfigured and host-stopped branches of both handlers.
9. When quota lands: build (`gcloud builds submit --config workers/longcat/cloudbuild.yaml ...`), run `deploy-gce.sh`, wait for `curl <host>/health` to report `model_loaded: true`, then `gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --update-env-vars LONGCAT_WORKER_URL=<url>,LONGCAT_WORKER_KEY=<key>`. Verify a real generation through `POST /api/avatar/video-generate`, poll `video-status`, and confirm `GET /api/config` reports `videoAvatarEnabled: true`. Record cost per minute of video and idle burn.
10. Document the full bring-up in `workers/longcat/README.md` as three owner-visible commands (start host, set env with `--update-env-vars`, smoke) with quota status, request id, expected monthly credit burn and the exact remaining owner step. Add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] Worker CPU tests and `python check_pins.py` pass.
- [ ] `gcloud alpha quotas preferences list --project aerial-vehicle-466722-p5 | grep -i a100` shows the pending request, or quota is granted.
- [ ] `gcloud storage ls -l gs://three-ws-model-weights/longcat/` shows the full weight set matching `workers/longcat/weights.sha256`.
- [ ] `npx vitest run tests/longcat-provider.test.js workers/longcat/tests` passes.
- [ ] `node workers/longcat/scripts/host.mjs status` runs and reports the host state without error.
- [ ] `workers/longcat/deploy-gce.sh` exists and is shellcheck-clean, and ran once to a healthy host (`model_loaded: true`), or the README records the exact remaining step (quota approval id) with everything else done.
- [ ] After wiring, `curl -s https://three.ws/api/config` reports `videoAvatarEnabled: true` (or the README states this is pending quota).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A100-80GB quota is 0 | Submit the quota preference and try Spot, H100 `a3-highgpu-1g` or alternate regions in parallel; finish every other task, leave the final deploy as one documented command, report the pending request id |
| Weight staging is slow | Run it as a background Cloud Build job and continue with the other tasks |
| `--set-env-vars` temptation on three-ws-api | Always `--update-env-vars` |
| No GPU in the sandbox | Tests use recorded task logs and fake clocks; no GPU is needed for any test here |
| Idle GPU burning credits | Idle auto-stop (task 6) is mandatory before any verification run |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Starting the 80GB GPU host to run a real generation spends GCP credits (pre-approved resource, but Google's quota grant is an outside-party step the agent cannot control). Stop at "quota granted -> run `host.mjs start`" and report it. No other gate.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/977-plan-avatar-longcat-gpu-host-bringup.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `977-plan-avatar-longcat-gpu-host-bringup.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `workers/longcat/README.md` (whole file)

~~~~markdown
# LongCat Video Avatar Worker

FastAPI service that turns a reference image plus an audio clip into a
lip-synced talking-avatar MP4, using
[meituan-longcat/LongCat-Video-Avatar-1.5](https://huggingface.co/meituan-longcat/LongCat-Video-Avatar-1.5)
(MIT license). Output videos land in Cloud Storage; job state lives in Firestore.

**Status: built and tested, not deployed.** No `longcat-video-avatar` Cloud Run
service exists, `LONGCAT_WORKER_URL` is not set on `three-ws-api`, and the
weights are not staged. The site handles that cleanly: `/api/avatar/video-generate`
answers `503 worker_unconfigured` and burns no free-trial quota
([api/avatar/video-generate.js](../../api/avatar/video-generate.js)). See
[Why this is not on Cloud Run](#why-this-is-not-on-cloud-run) for the blocker
and [Running it](#running-it) for the hardware that does work.

## API

```
POST /generate  { image_url, audio_url, prompt?, job_id? }
             →  202 { job_id, status: "queued" }
             →  503 when the model weights are not staged on the instance

GET  /jobs/:id  → { job_id, status, progress, segments, audio_seconds,
                    video_url?, error?, created_at, updated_at }
             →  404 when the job id is unknown

GET  /health    → { ok, pipeline, model_loaded, missing_weights, weights_dir,
                    checkpoint_dir, base_model_dir, resolution, max_segments }
```

`/generate` and `/jobs/:id` require `Authorization: Bearer <API_KEY>` and answer
`401` without it. `/health` is unauthenticated so a load balancer can probe it;
it reports `model_loaded: false` and lists the absent files in
`missing_weights` when the staging is incomplete.

`status` moves `queued` → `running` → `done` | `failed`. `progress` is a 0-1
fraction that only ever moves forward, even across segments. `error` is an
opaque `internal error (ref <id>)` string; the matching correlation id is in the
service log with the full traceback.

`image_url` and `audio_url` may be `https://` URLs or inline `data:` URIs. HTTPS
fetches are SSRF-hardened by [worker_security.py](worker_security.py): https
only, DNS-resolved addresses in private, loopback, link-local or metadata ranges
are refused, every redirect hop is re-validated, and the body is size-capped.

### Example

```bash
KEY=$(gcloud secrets versions access latest --secret=longcat-video-avatar-key)
BASE=http://localhost:8080

JOB=$(curl -sS -X POST "$BASE/generate" \
  -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"image_url":"https://three.ws/avatars/render/example.png",
       "audio_url":"https://three.ws/audio/example.wav",
       "prompt":"A person talking naturally."}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["job_id"])')

curl -sS "$BASE/jobs/$JOB" -H "authorization: Bearer $KEY"
```

## How generation works

One inference pass produces a fixed 93-frame clip at 25 fps, which is 3.72 s of
video. Longer audio needs continuation segments, and each one re-generates 13
frames of overlap with the previous segment, so it adds 3.2 s of new video:

    covered_seconds(n) = 3.72 + (n - 1) * 3.2

The service probes the real audio duration with `ffprobe` and asks upstream for
enough segments to cover it, capped by `MAX_SEGMENTS`. A 10-second voice clip
runs 3 segments; the default cap of 8 covers 26.12 s. Upstream pads the audio
with silence up to the generated length, so overshooting by part of a segment is
harmless, while undershooting would drop the tail of the speech.

Each continuation save re-encodes every frame generated so far, so the final
artifact is the highest-numbered `video_continue_N.mp4`, not a concatenation
step. `save_video_ffmpeg` also leaves two audio-less intermediates next to it
(`-temp.mp4` and `-cropvideo.mp4`); the service skips those explicitly. The
rules live in [inference_plan.py](inference_plan.py) and are covered by
[test_inference_plan.py](test_inference_plan.py).

The command the service runs, per job:

```
torchrun --nproc_per_node=1 run_demo_avatar_single_audio_to_video.py \
  --input_json <job config> --output_dir <job output> \
  --checkpoint_dir $WEIGHTS_DIR/LongCat-Video-Avatar-1.5 \
  --resolution $RESOLUTION --model_type avatar-v1.5 --stage_1 ai2v \
  --num_segments <computed> --use_distill --use_int8
```

`--stage_1 ai2v` is audio-image-to-video: it consumes the reference image. The
`at2v` alternative ignores the image entirely, which is never what this service
wants.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `API_KEY` | yes | | shared bearer secret |
| `GCS_BUCKET` | yes | | bucket for output MP4s (`avatar-videos/<job_id>.mp4`) |
| `FIRESTORE_PROJECT` | yes | | project hosting the `longcat_video_jobs` collection |
| `WEIGHTS_DIR` | no | `/weights/longcat` | root holding both model repos |
| `LONGCAT_REPO_DIR` | no | `/longcat` | the cloned upstream repo |
| `MAX_CONCURRENT` | no | `1` | parallel jobs; keep it at 1 (see below) |
| `MAX_SEGMENTS` | no | `8` | segment cap, so one long upload cannot monopolise the GPU |
| `RESOLUTION` | no | `720p` | `480p` (480x832) or `720p` (768x1280); anything else fails at boot |

Leave `MAX_CONCURRENT` at `1`. Beyond the obvious point that one GPU cannot run
two of these jobs, upstream writes its vocal-separation scratch files to a fixed
`./audio_temp_file` relative to the repo, so two concurrent runs would race on
the same path. Scale with more hosts, not more workers per host.

## Model weights

Two HuggingFace repos must be staged side by side, because upstream loads the
tokenizer, UMT5 text encoder and VAE from `<checkpoint_dir>/../LongCat-Video`:

```
$WEIGHTS_DIR/
  LongCat-Video/              tokenizer/  text_encoder/  vae/
  LongCat-Video-Avatar-1.5/   base_model_int8/  lora/  scheduler/
                              whisper-large-v3/  vocal_separator/
```

Only the files this worker's flags dereference are needed: 44.81 GB, against
158 GB for both repos in full. [stage-weights.sh](stage-weights.sh) fetches
exactly that set, verifies the layout, and uploads it to the shared bucket:

```bash
workers/longcat/stage-weights.sh --dry-run     # list files and sizes, download nothing
workers/longcat/stage-weights.sh --local-only  # download to $LOCAL_DIR, no upload
workers/longcat/stage-weights.sh               # download, verify, upload to GCS
```

The dry run resolves its include patterns against the live HuggingFace file
listing, so the size it prints is current rather than remembered:

```
meituan-longcat/LongCat-Video: 15 file(s), 23.25 GB
meituan-longcat/LongCat-Video-Avatar-1.5: 26 file(s), 21.56 GB
TOTAL: 44.81 GB
```

Excluded on purpose: `base_model/` (31.7 GB bf16 DiT, superseded by
`base_model_int8` under `--use_int8`), the base repo's `dit/` (54 GB, that is the
text-to-video model, not the avatar one), whisper's flax / `.bin` / fp32
duplicates (19.5 GB of the same weights), and `chinese-wav2vec2-base` (the
avatar-v1.0 audio encoder; v1.5 uses whisper-large-v3).

[model_weights.py](model_weights.py) holds the authoritative required-file list.
The service checks it at startup and on every `/generate`, so an incomplete
staging surfaces as a `503` and a log line naming the missing paths, not as a
CUDA error two minutes into a job.

## Why this is not on Cloud Run

Upstream's `LongCatVideoAvatarPipeline.to(device)` moves the DiT, the text
encoder and the VAE onto one GPU, and the audio encoder is moved there
separately. Nothing is CPU-offloaded, so the resident weight set is the sum:

| Component | Source | Resident |
|---|---|---|
| UMT5 text encoder (bf16) | `LongCat-Video/text_encoder` | 22.72 GB |
| DiT, INT8 quantized | `Avatar-1.5/base_model_int8` | 15.88 GB |
| Distillation LoRA | `Avatar-1.5/lora/dmd_lora.safetensors` | 2.52 GB |
| whisper-large-v3 audio encoder | `Avatar-1.5/whisper-large-v3` | 3.09 GB |
| VAE | `LongCat-Video/vae` | 0.51 GB |
| **Total** | | **44.72 GB** |

Activations for 93 frames at 768x1280 sit on top of that. Cloud Run offers two
GPUs and neither works:

- **NVIDIA L4, 24 GB.** Less than half the weight set. `--use_int8` is already
  applied; there is nothing left to quantize away. Upstream's multi-GPU examples
  use context parallelism, which splits activations but replicates weights on
  every rank, so 2 x L4 does not help either.
- **NVIDIA RTX PRO 6000 Blackwell, 96 GB.** Enough memory, wrong architecture:
  it is compute capability 12.0 per
  [NVIDIA's own table](https://developer.nvidia.com/cuda-gpus) (where A100 is 8.0
  and H100 is 9.0), and the `torch==2.6.0+cu124` and
  `flash-attn==2.7.4.post1` wheels this stack pins ship kernels only up to
  sm_90. The shipped `base_model_int8/config.json` sets
  `enable_flashattn2: true`, so flash-attn is a hard runtime import, not an
  optimisation that can be dropped.

So [cloudbuild.yaml](cloudbuild.yaml) builds and publishes the image but does
not deploy it. Running it needs one 80 GB GPU at sm_80 or sm_90, which means
Compute Engine rather than Cloud Run.

## Running it

Build and publish the image:

```bash
gcloud builds submit --config workers/longcat/cloudbuild.yaml \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s)
```

Run it on a GPU host (an `a2-ultragpu-1g` with one A100-80GB, or an `a3-highgpu-1g`
with one H100-80GB), with the weights on a local disk or a mounted bucket:

```bash
docker run --rm --gpus all -p 8080:8080 \
  -e API_KEY="$(gcloud secrets versions access latest --secret=longcat-video-avatar-key)" \
  -e GCS_BUCKET=three-ws-avatar-reconstructions \
  -e FIRESTORE_PROJECT=aerial-vehicle-466722-p5 \
  -e WEIGHTS_DIR=/weights/longcat \
  -v /mnt/weights:/weights \
  us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/longcat-video-avatar/server:latest

curl -s localhost:8080/health   # model_loaded must be true before generating
```

GPU quota is the gate on the first real run. Read the live numbers rather than
trusting this paragraph:

```bash
gcloud compute regions describe us-central1 --project aerial-vehicle-466722-p5 \
  --format=json | python3 -c '
import json,sys
for q in json.load(sys.stdin)["quotas"]:
    if "A100" in q["metric"] or "H100" in q["metric"]:
        print(q["metric"], q["limit"], "used", q["usage"])'
```

As of 2026-08-11 that prints `NVIDIA_A100_80GB_GPUS 0.0` and
`NVIDIA_A100_GPUS 1.0` (the 40 GB part, itself too small for a 45 GB weight
set), with no H100 metric present. So one 80 GB device has to be requested
first: filter for `NVIDIA_A100_80GB_GPUS` on the
[quotas page](https://console.cloud.google.com/iam-admin/quotas?project=aerial-vehicle-466722-p5)
and raise the `us-central1` limit to 1. Credits policy and the fleet's GPU
budget: [docs/ops/gcp-credits-plan.md](../../docs/ops/gcp-credits-plan.md).

Once a host is serving, point the site at it and the `503` path turns into real
generation:

```bash
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars LONGCAT_WORKER_URL=<worker-url>,LONGCAT_WORKER_KEY=<api-key>
```

Use `--update-env-vars`, never `--set-env-vars`: the latter replaces the whole
environment. Full env and rollback runbook:
[docs/ops/gcp-production.md](../../docs/ops/gcp-production.md).

## Prerequisites for a first deploy

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com storage.googleapis.com \
  firestore.googleapis.com secretmanager.googleapis.com

# API key secret (the service compares bearer tokens against it in constant time).
# Already created on 2026-08-11 as a 64-hex-character version 1, so this line is
# only for a fresh project.
openssl rand -hex 32 | tr -d '\n' | \
  gcloud secrets create longcat-video-avatar-key --data-file=- \
    --project aerial-vehicle-466722-p5 --replication-policy=automatic

# Firestore, native mode. aerial-vehicle-466722-p5 already has a (default)
# FIRESTORE_NATIVE database in us-central1, so this too is only for a new project.
gcloud firestore databases create --location=us-central1
```

```bash
# Artifact Registry repository (created 2026-08-11; kept out of cloudbuild.yaml
# because three-ws-build@ has no artifactregistry.repositories.create permission)
gcloud artifacts repositories create longcat-video-avatar \
  --repository-format=docker --location us-central1 \
  --project aerial-vehicle-466722-p5 \
  --description="LongCat-Video-Avatar-1.5 talking-avatar worker"
```

Output MP4s go to `three-ws-avatar-reconstructions`, the bucket the other model
workers already use, under the `avatar-videos/` prefix; no new bucket is needed.
That bucket already grants `allUsers` `roles/storage.objectViewer`, which is what
makes the `https://storage.googleapis.com/<bucket>/avatar-videos/<job>.mp4` URL
the worker returns readable by a browser without signing. Weights go to
`three-ws-model-weights` under `longcat/`, which is the same shared bucket the
rig, text2motion and TripoSG workers mount.

## Tests

```bash
python3 workers/longcat/test_inference_plan.py   # segment math, output choice, progress
python3 workers/longcat/test_model_weights.py    # the two-repo layout upstream requires
python3 workers/longcat/test_app_smoke.py        # imports, routes, auth, the 503 gate
```

The first two are stdlib-only. The third imports the app, so it needs
[requirements.txt](requirements.txt) installed; it drives the handlers directly
and never contacts GCP. All three run inside `docker build` as gates, so a
regression fails the image rather than shipping.

## Cost and capacity

The GPU host is the dominant line item, so this worker should not sit warm. Both
candidate shapes exist in `us-central1-a` today (verified with
`gcloud compute machine-types describe`):

| Machine type | GPU | vCPU | RAM |
|---|---|---|---|
| `a2-ultragpu-1g` | 1x A100-80GB (sm_80) | 12 | 170 GB |
| `a3-highgpu-1g` | 1x H100-80GB (sm_90) | 26 | 234 GB |

Price them from the Compute Engine pricing page before leaving one running; an
always-on 80 GB GPU dwarfs every other cost in this worker. Keeping the 44.81 GB
of weights in `three-ws-model-weights` costs cents per month by comparison and
saves a 45 GB re-download on every new host, so stage once and leave them.

Per-job latency has not been measured on our hardware, and upstream publishes no
per-segment number for the distilled 8-step avatar path, so do not hardcode a
client timeout from a guess. Take it from the first real run: `/jobs/:id` exposes
`segments` and a monotonic `progress`, which is enough to drive a real progress
bar rather than a spinner. `/generate` is asynchronous precisely because a
multi-segment 720p job is minutes, not seconds.
~~~~

### `workers/deploy/README.md` (whole file)

~~~~markdown
# Cloud Run fleet deploy runbook

Three bash runbooks that provision and deploy the three.ws GPU/CPU worker fleet
to Google Cloud Run, idempotently and in the right order. They are operator
tools: nothing here is deployed as a service of its own, and nothing runs on a
schedule. You run them by hand from a shell with `gcloud` authenticated.

| Script | What it deploys | GPU? |
| --- | --- | --- |
| [`stage-weights.sh`](./stage-weights.sh) | nothing: stages model weights into `gs://three-ws-model-weights` | no |
| [`deploy-all.sh`](./deploy-all.sh) | the avatar reconstruction pipeline: mesh models + rigging + the CPU controller | yes |
| [`deploy-editing.sh`](./deploy-editing.sh) | the mesh-editing workers behind `/forge`: stylize, remesh, segment, rembg (+ texture, text2motion) | CPU by default |

The scripts share infrastructure: the same runtime service account, the same
output bucket, and the same `avatar-reconstruction-key` secret. Running one
before, after, or instead of the others is fine.

---

## The avatar pipeline

```
/scan (browser)
   └─ POST /api/avatars/reconstruct      (three-ws-api on Cloud Run)
        └─ controller  /reconstruct      (Cloud Run, CPU)   ← GCP_RECONSTRUCTION_URL
             ├─ mesh model /infer        (Cloud Run, L4 GPU)  Hunyuan3D / TRELLIS / TripoSR / TripoSG
             └─ model-rig  /rig          (Cloud Run, L4 GPU)  skeleton + skinning + ARKit-52
                  └─ rigged GLB → GCS → materialized as an avatar the user downloads
```

The site talks **only** to the controller. The controller fans out to the model
and rigging services and returns one rigged GLB.

**What production runs today.** `three-ws-api` points `GCP_RECONSTRUCTION_URL`
at the standalone [`avatar-reconstruction`](../avatar-reconstruction/) worker,
not at `avatar-pipeline-controller`, and `GCP_UNIRIG_URL` at `model-rig`.
`deploy-all.sh` stands the controller pipeline up as its own set of services and
prints the wiring command; it does not repoint the live site. Switching the site
over is the deliberate `gcloud run services update` at the end of the run.

### What you need before running

1. **A GCP project** with the credits / billing account linked.
2. **Cloud Run L4 GPU quota** in your region (default `us-central1`). This is the
   one thing that can block you and can take hours to approve, so request it
   first: Console → IAM & Admin → Quotas → filter "Cloud Run Admin API" →
   `nvidia_l4_gpu_allocation_no_zonal_redundancy` (and the zonal one) → request
   at least 1 per service you deploy concurrently.
3. **A Hugging Face token** (`HF_TOKEN`) for license-gated repos. TRELLIS,
   TripoSR, TripoSG and the Make-It-Animatable assets are open; the Mixamo bone
   dataset the rig worker needs is auto-gated and still wants a token.
4. **~80 GB free disk** wherever you run `stage-weights.sh` in local mode. Cloud
   Shell has ~5 GB, which is why gcsfuse mode is the default there.

### Fastest path: Google Cloud Shell

Cloud Shell is pre-authenticated to your account and already has `gcloud`,
`gsutil`, `python3`, `docker`, and `gcsfuse`. No credential sharing.

```bash
# in Cloud Shell, from a clone of this repo:
cd workers/deploy

# 1. stage the mesh-model weights into gs://three-ws-model-weights  (run once)
#    gcsfuse mode is the default and is REQUIRED in Cloud Shell: the fleet is
#    ~80 GB and Cloud Shell has ~5 GB of local disk, so weights stream straight
#    into the bucket. On a big-disk GCE VM you can use LOCAL_STAGE=1 instead.
HF_TOKEN=hf_xxx SERVICES="hunyuan3d trellis triposr triposg" ./stage-weights.sh

# 2. stage the rig worker's assets (separate script, see below)
HF_TOKEN=hf_xxx bash ../rig/stage-assets.sh

# 3. provision + build + deploy everything, in order
PROJECT_ID=your-project-id SERVICES="hunyuan3d trellis triposr rig" ./deploy-all.sh
```

`deploy-all.sh` is idempotent, so it is safe to re-run. It enables the APIs,
creates the two GCS buckets, creates Firestore (native mode), creates the
`avatar-reconstruction-key` secret, grants the runtime service account its
roles, builds and deploys each GPU service, deploys the controller and **wires
it to the service URLs**, then prints the exact `gcloud run services update`
command for the site.

### Default vs full fleet

| `SERVICES` | what you get | cost/complexity |
| --- | --- | --- |
| `hunyuan3d rig` *(default)* | Textured mesh plus a rig, which is the "rigged model" promise | 2 GPU services |
| `triposr rig` | Fastest mesh (~5-15 s, untextured) plus a rig | 2 GPU services, cheapest |
| `hunyuan3d trellis triposr triposg rig` | All mesh backends (the controller load-balances) plus a rig | 5 GPU services |

Start with the default. The controller routes across whatever mesh backends are
wired, so adding more later is another `deploy-all.sh` run with a wider
`SERVICES`.

### Service keys

The key you pass in `SERVICES` is not always the Cloud Run service name:

| key | worker dir | Cloud Run service | controller env var |
| --- | --- | --- | --- |
| `hunyuan3d` | [`model-hunyuan3d/`](../model-hunyuan3d/) | `model-hunyuan3d` | `MODEL_HUNYUAN3D_URL` |
| `trellis` | [`model-trellis/`](../model-trellis/) | `model-trellis` | `MODEL_TRELLIS_URL` |
| `triposr` | [`model-triposr/`](../model-triposr/) | `model-triposr` | `MODEL_TRIPOSR_URL` |
| `triposg` | [`model-triposg/`](../model-triposg/) | `model-triposg` | `MODEL_TRIPOSG_URL` |
| `rig` | [`rig/`](../rig/) | `model-rig` | `UNIRIG_URL` |

`UNIRIG_URL` is a historical name. It is live on the running services and on
`three-ws-api` (as `GCP_UNIRIG_URL`), and it now points at the Make-It-Animatable
rig worker. The `unirig` worker it was named for was retired in favour of
[`rig/`](../rig/); there is no `unirig` Cloud Run service and no service key for
it here.

### After deploy: wire the site

`deploy-all.sh` prints the command. Production runs on Cloud Run (since
2026-07-07), so the wiring is an env update on `three-ws-api`:

```bash
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 \
  --update-env-vars AVATAR_REGEN_PROVIDER=gcp,GCP_RECONSTRUCTION_URL=https://avatar-pipeline-controller-....run.app
```

Use `--update-env-vars`, never `--set-env-vars`: the latter replaces the
service's entire env set and drops every other variable the site needs.
`GCP_RECONSTRUCTION_KEY` is already mounted on `three-ws-api` straight from
Secret Manager (`avatar-reconstruction-key`), the same secret the workers
authenticate against, so it does not need to be pasted anywhere.

`AVATAR_REGEN_PROVIDER=gcp` pins the provider so the resolver never falls back to
the flaky free Hugging Face Space path. Full env/deploy runbook:
[`docs/ops/gcp-production.md`](../../docs/ops/gcp-production.md).

Verify: open `/scan`, capture a selfie, expect a downloadable **rigged** GLB in
1-2 min. Watch logs with
`gcloud run services logs read avatar-pipeline-controller --region us-central1`.

---

## Weights: what each script stages, and what it does not

`stage-weights.sh` handles one thing well: Hugging Face repos that land in a
bucket prefix a worker reads. Its `weight_source` map is the source of truth for
those, and [`tests/workers-deploy-fleet.test.js`](../../tests/workers-deploy-fleet.test.js)
asserts every prefix matches the one the worker's `cloudbuild.yaml` actually
reads, because a mismatch surfaces only as a cold-start 503.

| key | Hugging Face repo(s) | bucket prefix |
| --- | --- | --- |
| `hunyuan3d` | `tencent/Hunyuan3D-2` | `hunyuan3d-2` |
| `hunyuan3d21` | `tencent/Hunyuan3D-2.1`, `facebook/dinov2-giant` | `hunyuan3d-2.1`, `dinov2-giant` |
| `trellis` | `microsoft/TRELLIS-image-large` | `trellis-large` |
| `triposr` | `stabilityai/TripoSR` | `triposr` |
| `triposg` | `VAST-AI/TripoSG`, `VAST-AI/TripoSG-scribble`, `briaai/RMBG-1.4` | `triposg`, `triposg-scribble`, `rmbg-1.4` |

`hunyuan3d` and `hunyuan3d21` are different models in different prefixes.
`model-hunyuan3d` runs Hunyuan3D-2.0 out of `hunyuan3d-2/`; `model-hunyuan3d-21`
and `model-hunyuan3d-21-rtx` run Hunyuan3D-2.1 out of `hunyuan3d-2.1/` and are
deployed from their own configs
([`cloudbuild.hunyuan21.yaml`](../model-hunyuan3d/cloudbuild.hunyuan21.yaml)),
not from `deploy-all.sh`.

Three workers are deliberately **not** staged by `stage-weights.sh`:

- **`rig`** stages via [`workers/rig/stage-assets.sh`](../rig/stage-assets.sh).
  Its assets span an LFS-filtered model repo, a gated Mixamo dataset, and a baked
  ARKit template, which a one-repo-per-service map cannot express.
- **`texture`** stages via
  [`workers/texture/stage_weights.py`](../texture/stage_weights.py)
  (`--prefix sdxl-texture`). It hands the staged directory to diffusers as
  `cache_dir`, so the tree has to be a Hugging Face *cache* tree, not the flat
  `--local-dir` layout `stage_repo` writes. Its image bakes ControlNet-Depth
  only, so skipping this leaves the service downloading SDXL inside the first
  request and burning the 600 s timeout.
- **`text2motion`** reads the MDM checkpoint from `gs://<bucket>/mdm/`
  (`model.pt` + `args.json`). That checkpoint is not a Hugging Face repo; it is
  the `humanml_trans_enc_512` release of
  [motion-diffusion-model](https://github.com/GuyTevet/motion-diffusion-model),
  copied into the prefix by hand.

---

## Editing workers: `deploy-editing.sh`

The mesh-editing services behind `/api/forge-stylize`, `/api/forge-remesh`,
`/api/forge-segment` and `/api/forge-rembg` are **CPU-only**: no GPU quota, no
staged weights. A clean project deploys in ~10 minutes:

```bash
# in Cloud Shell, from a clone of this repo:
PROJECT_ID=your-project-id ./workers/deploy/deploy-editing.sh

# just one service:
PROJECT_ID=your-project-id SERVICES="stylize" ./workers/deploy/deploy-editing.sh
```

It prints the env vars the site needs (`GCP_STYLIZE_URL`, `GCP_REMESH_URL`,
`GCP_SEGMENT_URL`, `GCP_REMBG_URL`) plus the `gcloud run services update`
command that sets them. Pass `WIRE_SITE=1` to have the script run that update
itself; it is opt-in because it mutates a running production service.

GPU extras: `SERVICES="texture text2motion"` deploys the retexture and
text-to-animation workers too. Both need L4 quota, and both need weights staged
by their own stager first (see the section above); the script warns about each
before it starts building.

---

## Cost (covered by credits)

Read this before a first deploy: **the default fleet does not scale to zero.**
`_MIN_INSTANCES` is `1` in `model-hunyuan3d`, `model-trellis`, `rig`, and the
controller, and `0` in `model-triposr`, `model-triposg`, `texture`, and
`model-text2motion`. A `min-instances=1` GPU service keeps an L4 allocated and
billing around the clock, not only while a job runs. At ~\$0.71/hr on-demand
that is roughly \$17/day per warm L4, so the default `hunyuan3d rig` fleet burns
continuously whether or not anyone scans.

That is a deliberate latency tradeoff (a cold L4 start on this image is minutes,
not seconds), but it is a choice you should make on purpose:

```bash
# deploy the whole fleet cold-start-only
PROJECT_ID=your-project-id MIN_INSTANCES=0 ./deploy-all.sh

# or scale one service down after the fact
gcloud run services update model-trellis --region us-central1 --min-instances=0
```

The controller itself is CPU-only and cheap, so leaving it warm is what keeps
the first scan of the day from waiting on a cold start. Once a service is warm,
the marginal GPU time of a scan is ~\$0.02-0.05, and weight storage is a few
GB-months. All of it is inside the credits; the burn rules and the pre-approved
scaling envelope are in
[`docs/ops/gcp-credits-plan.md`](../../docs/ops/gcp-credits-plan.md), and
[`scripts/gcp/revert-to-free.sh`](../../scripts/gcp/revert-to-free.sh) flips the
whole fleet back off its credit-funded lanes.

---

## Build identity

Every `workers/*/cloudbuild.yaml` pins `serviceAccount:` to
`three-ws-build@aerial-vehicle-466722-p5`, because this project has no default
compute service account. That pin hardcodes one project, so both deploy scripts
pass `--service-account` to re-point it at `$PROJECT_ID` (the CLI flag overrides
the config field). They default to `three-ws-build@$PROJECT_ID` when that account
exists and fall back to the runtime SA
(`avatar-reconstruction-sa@$PROJECT_ID`), which the IAM step grants
`roles/cloudbuild.builds.builder`. Override either with `BUILD_SA` / `RUN_SA`.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Build fails on `pip install hy3dgen`/`trellis` | The git-sourced CUDA package did not build. Check the Cloud Build log; TripoSR builds most reliably, so deploy `SERVICES="triposr rig"` first to prove the path, then add Hunyuan3D. |
| Service cold-starts then 503s on first request | Weights not staged for that model, or staged under the wrong prefix. Check the weights table above, then re-run `stage-weights.sh` with `FORCE=1`. |
| `quota exceeded … nvidia_l4` at deploy | GPU quota not yet granted in the region. See step 2 above. |
| Controller `/health` shows empty `backends` | The controller's `MODEL_*_URL` env was not set. Re-run `deploy-all.sh` (it re-wires), or set it manually with `gcloud run services update`. |
| Build fails with a service-account permission error | The target project has neither `three-ws-build@` nor a `cloudbuild.builds.builder` grant on the runtime SA. Pass `BUILD_SA=<an SA that can build>`. |
| `/scan` still says "warming up" after the env update | The env only applies to revisions created after the update. Confirm the new revision is serving, then check `/api/config` returns `avatarReconstructMode:"platform"`. |
~~~~

### `docs/ops/gcp-model-workers.md` (whole file)

~~~~markdown
# GCP model workers - the self-host generation lanes

three.ws runs open 3D models on our **own** Google Cloud Run GPU workers, against
the project's GCP credits. These self-host lanes are the resilient default for
`/api/forge`: every generation we can serve on our own hardware costs no vendor
money and carries no BYOK dependency. This runbook covers what is deployed, the
env that wires it in, how routing picks a lane, and how to (re)start a worker.

> Scope: routing + operations for the **forge** generation lanes. The avatar
> reconstruction pipeline (controller + the `model-rig` auto-rigger) is documented in
> `workers/deploy/README.md`; only its shared bearer secret overlaps here.

---

## The workers

Each model runs as its own Cloud Run service (NVIDIA L4 GPU, `us-central1`),
built and deployed from `workers/<dir>/cloudbuild.yaml`. They all speak the same
task shape - `POST /<endpoint> → { task_id }`, `GET /tasks/:id → { status,
result_* }` - and authenticate with one shared bearer secret.

| Lane (`backend` id) | Worker dir            | Cloud Run service  | Path served | What it does |
|---------------------|-----------------------|--------------------|-------------|--------------|
| `trellis2`          | `workers/model-trellis2` | `model-trellis2` | `image`  | Default image→3D lane. TRELLIS.2 (MIT): PBR GLB with alpha, `resolution` 512/1024/1536, meshopt packed. Weights staged by `workers/model-trellis2/stage_weights.sh`. |
| `trellis_selfhost`  | `workers/model-trellis`  | `model-trellis`  | `image`  | Native single-hop image→3D (Microsoft TRELLIS). Accepts user photos and the FLUX-synthesized view for text prompts. Textured GLB. |
| `hunyuan3d`         | `workers/model-hunyuan3d`| `model-hunyuan3d`| `image`  | High-poly image-conditioned reconstruction (Tencent Hunyuan3D). Poly-budget aware. |
| `modly`             | `workers/modly`          | `model-modly`    | `image`  | TripoSG through Modly's headless backend (MIT). Single photo to untextured GLB, repaired and decimated to the tier's face budget. Weights staged by `workers/modly/stage_weights.sh`. |
| `modly_hunyuan`     | `workers/modly`          | `model-modly`    | `image`  | Hunyuan3D 2 Mini Turbo on the same worker. Untextured. A Tencent lane: never routed to a restricted or unknown territory (`api/_lib/forge-territory.js`). |
| `triposg`           | `workers/model-triposg`  | `model-triposg`  | `sketch` | Sketch→3D (TripoSG-scribble): a drawing + a prompt naming it → untextured geometry. |

All three are `provider: 'gcp'`, `free: true`. `model-trellis` pins one
always-warm instance and bursts to three under load (`_MIN_INSTANCES: "1"`,
`_MAX_INSTANCES: "3"`): a cold FUSE-mounted weight load can stall for many
minutes, and the GCP credit budget covers the standing GPU-hour.
`model-hunyuan3d`'s cloudbuild default is also min 1, but the live service was
set to `--min-instances=0` on 2026-07-26 to free the shared us-central1 L4 pool
(3 granted; see the `gpu-quota-starved` signature in
`docs/ops/production-log-triage.md`); `model-triposg` scales to zero. A
**cold start** on a scale-to-zero worker pays a one-time model-load before the
job runs. We surface that honestly (see *Cold start*), never as a fake timer,
and the `gpu-keepwarm` cron (`api/cron/gpu-keepwarm.js`, every 10 min during
peak hours via Cloud Scheduler) holds allowlisted scale-to-zero lanes resident
where warming them does not contend for that L4 pool (`FORGE_KEEPWARM_LANES`
overrides the set without a deploy). A lane id in that override that matches no
known lane comes back in the tick's `unknown_lanes` and drops its `ok` to false,
so a typo in the env var fails visibly instead of quietly warming nothing.

Every routed lane that scales to zero must appear in that registry even when it
is not warmed by default, because the registry is what the override can reach: a
lane missing from it is unwarmable at any quota, and its absence is invisible
(the tick's `skipped_for_quota` simply lists one fewer deferred lane and still
reads healthy). `model-hunyuan3d` sat outside it that way despite carrying the
fleet's longest spin-up. `tests/cron-forge-lane-guards.test.js` now pins the
registry against `BACKENDS`: every `provider: 'gcp'` lane with a
`coldStartSeconds` budget must be listed, under the same URL env var the router
itself resolves that worker from, so a typo'd `urlEnv` (which would report
`unconfigured` forever without ever throwing) fails the suite instead.

`us-east4` has its own grant of 3 L4s and the same arithmetic applies there. It
runs standbys of `model-trellis` (pinned at min 1), `model-hunyuan3d`,
`model-triposr`, and `model-text2motion`, which is that region's production lane
(`GCP_TEXT2MOTION_URL`, max 2) and the only one of the four carrying user
traffic. The `model-triposr` standby was pinned at min 1 until 2026-08-11, which
left text2motion a single slot to burst into; it now scales to zero, as does the
`model-triposr-warm` Cloud Scheduler probe in `us-central1` (paused the same
day, since each 10-minute ping cold-booted an L4 for a lane with no traffic).
Re-pinning either one is a quota decision: name the lane giving up the slot.

Wire shapes: `model-trellis` and `model-hunyuan3d` both speak the standard task
shape (`POST /infer` → `{ task_id }`, `GET /tasks/:id` → `result_gcs_url`);
the gcp provider drives them with modes `trellis` and `hunyuan` respectively.
The Hunyuan worker also aliases `/reconstruct` + `/jobs/:id` (returning
`glb_url`) for callers still on the avatar-controller contract; new code should
use the `hunyuan` mode.

The `remesh`, `stylize`, `texture`, `rembg`, `segment` workers back
post-generation tools (Game-Ready export, retexture, etc.), not the primary
generation lanes; they follow the same task shape and bearer secret.

---

## Environment

A self-host lane is **configured** only when its worker URL **and** the shared
key are present; a deployment missing either degrades cleanly - the lane drops
out of routing and the catalog reports it `configured: false`. Nothing is ever
faked.

| Env var                 | Used by                | Notes |
|-------------------------|------------------------|-------|
| `MODEL_TRELLIS2_URL`    | `trellis2`             | Cloud Run URL of `model-trellis2`. Unset means the lane is skipped. |
| `MODEL_TRELLIS_URL`     | `trellis_selfhost`     | Cloud Run URL of `model-trellis`. |
| `GCP_HUNYUAN3D_URL`     | `hunyuan3d`            | Cloud Run URL of `model-hunyuan3d`. **Not** `GCP_RECONSTRUCTION_URL` - that is the avatar face pipeline, which rejects non-face images. |
| `MODEL_MODLY_URL`       | `modly`, `modly_hunyuan` | Cloud Run URL of `model-modly`. Unset means both Modly lanes are skipped. |
| `GCP_TRIPOSG_URL`       | `sketch`, `triposg`    | Cloud Run URL of `model-triposg`. Serves the sketch lane and the last-resort, untextured photo rung of the poll-time failover. |
| `GCP_UNIRIG_URL`        | auto-rig (`rerig`)     | Cloud Run URL of `model-rig` (the env name predates the engine swap that retired the old `unirig` service). Required for rigging: it is the only `rerig` backend, so without it the provider reports the mode unsupported rather than submitting anywhere. The provider speaks the worker's native schema (`mesh_gcs_url` in, `rigged_gcs_url` out) when this is set. |
| `GCP_RECONSTRUCTION_KEY`| all of the above       | Shared bearer secret every worker checks (`avatar-reconstruction-key` in Secret Manager; `model-rig`'s `API_KEY` references the same secret). |
| `GCP_REMESH_URL`        | Game-Ready export      | `model`/`remesh` worker (post-gen). |
| `MODEL_LATO2_URL`       | Game-Ready "Artist mesh" | Cloud Run URL of `model-lato2` (LATO.2, MIT). Optional: unset means the Artist mesh topology quietly delivers QuadriFlow output. Deploy: run `workers/model-lato2/stage_weights.sh`, then `gcloud builds submit --config workers/model-lato2/cloudbuild.yaml`. |
| `FORGE_PREFER_FREE`     | routing (optional)     | Defaults on. Set `false` only to restore the paid-default ordering once the paid account is funded. |

The URL each worker registers on the `three-ws-api` Cloud Run service env is
printed at the end of `workers/deploy/deploy-all.sh`, or read it from
`gcloud run services describe <service> --region us-central1 --format='value(status.url)'`.

Secrets never appear in logs or the public catalog.

---

## How routing picks a lane

Routing is health-aware and free-first. For a request with no explicitly chosen
backend, `/api/forge` builds the ordered list of free lanes that can serve the
`(path, tier, userImages)` request (`freeLaneCandidates` in
`api/_lib/forge-tiers.js`), then picks with a cached liveness snapshot
(`api/_lib/forge-lane-health.js`):

1. **Healthy self-host first.** The first lane the liveness probe confirms `ok`,
   and our own GPU workers lead the ordering - so a healthy `trellis_selfhost`
   (then `hunyuan3d`) wins before any external free lane.
2. **Then another healthy free lane.** NVIDIA NIM (native text→3D, draft/standard)
   or HuggingFace Spaces (photos + high tier) when no self-host lane is healthy.
3. **Only then the paid default.** The standing Replicate TRELLIS lane is the
   last resort, used solely when **every** free lane is confirmed down or none is
   configured. BYOK vendors (Meshy/Tripo/Rodin) are never auto-selected - they
   stay explicitly selectable in the catalog.

Liveness combines two signals, both fail-open (missing telemetry never blocks a
lane - an unknown lane is treated as usable):

- A recent submit failure records a short **cooldown** in the shared cache, so
  every instance skips a just-failed lane until it expires.
- A cheap **authenticated GET** against the worker root (Cloud Run answers
  `<500` once routable). Round-trip latency doubles as a warmth signal.

The snapshot is cached per instance (~20s), so a burst of generations shares one
probe and the hot path usually pays no probe latency.

### Submit-time failover

Health routing skips a lane known-bad *before* submit. As a safety net, if the
chosen self-host worker still errors or times out at submit (cold, restarting,
throttled), the handler cools that lane and transparently retries the next
configured lane for the path - `trellis_selfhost` → `hunyuan3d` → HuggingFace →
paid Replicate - before surfacing any error. The `sketch` path has a single lane,
so a TripoSG failure returns a designed, retryable `503` rather than a dead error.
Every response reports the `backend` that actually served it, so a failover is
never silent.

### Poll-time failover

A worker can also accept a task and then fail it asynchronously - the failure
only surfaces on a later `GET /api/forge?job=<id>` poll. That poll
(`api/_lib/forge-failover.js`) cools the failed lane, recovers the original
inputs from the creation row (prompt + reference image), resubmits to the next
configured async lane (`trellis_selfhost` → `hunyuan3d` → paid Replicate, up to
3 backups per job), and binds old-handle → new-handle in Redis. The client
keeps polling the same id and sees `status: "running"` with the new `backend`
plus `failover_from` - the failure never reaches the user. When no automatic
lane remains, the terminal `failed` response names the still-configured lanes
in `retry_backends` so the forge UI offers one-click engine switches (and hops
to the first one automatically). HuggingFace can't be driven from a poll (its
provider blocks through the generation), so it appears only in the
suggestions, served by the client's fresh resubmit. Without Redis the
successor chain disables cleanly and only the suggestion layer applies.

### Cold start

When the liveness probe reaches a self-host worker but it answers slowly (a
scale-to-zero container spinning up), the response carries `cold_start: true` and
the `eta_seconds` is widened by that worker's cold-start budget
(`coldStartSeconds` in the registry). This only widens the **estimate** - actual
progress still comes from real polling of `GET /api/forge?job=<id>`.

---

## The realism pipeline (text→3D)

Everything below runs on GCP credits; no third-party API is involved.

1. **Prompt direction.** The Granite art-director pass runs by default on text
   prompts (`director: false` opts out): it rewrites the raw prompt into a
   single-subject spec with photoreal-by-default material cues
   (`api/_lib/forge-director-prompts.js`). Fail-soft: a dead LLM lane keeps
   the raw prompt.
2. **Reference image.** `textToImage()` leads with the Vertex Gemini image
   model (`gemini-2.5-flash-image`) when `GOOGLE_CLOUD_PROJECT` is set,
   materially more photoreal than 4-step distilled FLUX. `VERTEX_IMAGEN_FIRST=0`
   restores the legacy NIM-first order. `enhanceFluxPrompt()` appends realism +
   isolation cues unless the caller named an art style or composition.
3. **Turnaround views.** For the fusing self-host TRELLIS lane at standard/high
   tier, `synthesizeTurnaroundViews()` rotates the reference into side + back
   views via the Vertex Gemini edit lane (identity-preserving instructions).
   Best-effort: a failed view means fewer views, never a failed job.
4. **Multi-view fusion.** `workers/model-trellis` fuses all supplied views of
   one subject (`TrellisImageTo3DPipeline.run_multi_image`) so unseen sides
   stop being hallucinated. Single view uses the plain `run()` path.
5. **Per-tier sampler/export budgets.** `SELFHOST_TRELLIS_QUALITY`
   (`api/_lib/forge-tiers.js`) scales diffusion steps, kept geometry and baked
   texture size per tier (draft 12 steps/1K, standard 35/2K, high 50/4K;
   texture sizes must be powers of two or the nvdiffrast bake hard-fails); the
   worker clamps every knob server-side (`_clamped_quality`, defaults 40 steps
   / 4K texture / 0.75 simplify). The Hunyuan3D worker maps `tier` +
   `target_polycount` to its own generation budgets.

---

## Health & cost observability

- **Live health:** `GET /api/forge?health` probes every lane (auth/quota gates,
  zero vendor spend), the limiter store, and recent real generation outcomes.
- **Free-vs-paid serve counts:** the same payload's `metrics.by_cost` reports how
  many generations were served `free` (our GPU workers + free external lanes) vs
  `paid` (Replicate platform credits / BYOK), plus `metrics.free_share`. This is
  the headline number proving the vendor-cost reduction. Counters are the rolling
  buckets in `api/_lib/forge-events.js`; they need Redis (omitted otherwise).
- **Structured logs:** every terminal generation logs one `evt:"forge_gen"` JSON
  line with `backend`, so a log drain can compute the same split with no Redis.

---

## (Re)starting a GPU worker

The workers scale to zero; they do not need a manual "start" for normal traffic - the first request wakes a container (cold start). You restart/redeploy when
shipping a new image or recovering a wedged service.

**Redeploy a single worker** (Cloud Build builds the image and deploys the
service in one step):

```bash
gcloud builds submit --config workers/model-trellis/cloudbuild.yaml . \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s)
# swap in workers/model-hunyuan3d/… or workers/model-triposg/… as needed
```

`SHORT_SHA` is only populated for trigger-driven builds. A manual submit must
pass it, because these configs tag and deploy `.../server:$SHORT_SHA`, and an
empty tag fails the deploy step after the whole image has already built.

**Provision/redeploy the whole pipeline** (idempotent; prints the URLs to set on
the `three-ws-api` Cloud Run service env):

```bash
PROJECT_ID=<gcp-project> SERVICES="hunyuan3d trellis triposg rig" \
  workers/deploy/deploy-all.sh
```

**Force a fresh revision / clear a wedged container** without a code change:

```bash
gcloud run services update model-trellis --region us-central1 \
  --update-env-vars OPS_BUMP="$(git rev-parse --short HEAD)"
```

**Keep a worker warm** (eliminates cold starts at a standing GPU cost - use only
under sustained load):

```bash
gcloud run services update model-trellis --region us-central1 --min-instances 1
```

**Verify a worker is live** (same check the router's liveness probe makes):

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "authorization: Bearer $GCP_RECONSTRUCTION_KEY" "$MODEL_TRELLIS_URL"
# any <500 means up and routable
```

> Note: GPU-backed Cloud Run requires L4 quota in the region (`us-central1`).
> Quota approval can take hours - request it before a first deploy. The shared
> A100 workbench used for experiments is separate from these serving workers and
> may be stopped without affecting them.
~~~~

