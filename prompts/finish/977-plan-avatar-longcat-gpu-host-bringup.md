# LongCat video avatar worker runs on an 80GB GPU host with staged weights, an idle-stop lifecycle and API wiring

**Status (2026-11-04):** Shipped and committed: GCE host script with TLS front, startup, idle shutdown, GPU-hour ledger and cap, host.mjs lifecycle, quota request script (4 preferences filed, pending Google), weights staging job, API wake path with rate limits and 503 capacity handling, README bring-up. Remaining: A100-80GB quota grant (Google), weights staging build a7a81ea6-a398-4193-bf49-59f7dffcdadf (first attempt failed on huggingface-cli, fixed) then commit workers/longcat/weights.sha256 from the bucket, then owner runs deploy-gce.sh --wait and sets LONGCAT_WORKER_URL (production deploy gate).

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

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `workers/longcat/README.md`
- `workers/deploy/README.md`
- `docs/ops/gcp-model-workers.md`
