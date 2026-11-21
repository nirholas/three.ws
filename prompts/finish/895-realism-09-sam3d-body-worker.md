# Build the SAM 3D Body GPU worker: one photo in, MHR shape and pose parameters plus a mesh out

## How to run

Paste this whole file into a fresh Claude Code chat opened at `/home/user/three.ws`. It is self-contained: it needs no other chat and no input from the owner until the final report. If it names a prerequisite order that has not landed yet, this same session does that order first (its file says how), so nothing ever waits on another session. Read `prompts/finish/_context/realism-00-CONTEXT.md` (the campaign facts, licence table, shared realism option, hot files and deploy policy) before Step 0.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Licences are a hard gate: only what the licence table in the context file allows ships. Never vendor FLAME, BFM, SMPL, SMPL-X, MANO or anything trained on them.
- Solana is the home chain and leads every design. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`. If a credential, quota, database or test blocker appears, load `.claude/skills/self-unblock-playbook/SKILL.md` before considering any stop.

## Running alongside other sessions

Many sessions may be working in this same worktree at once, including the other `realism-` orders. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Your dev port is **4895** (`npx vite --port 4895 --strictPort`). Edit the hot shared files listed in the context file last, with the smallest possible hook.

## Why this matters

SAM 3D Body (Meta, SAM License, commercial use allowed worldwide) is a current state-of-the-art model for recovering a full human body (pose, shape, hands and face shape) from a single image. It predicts MHR parameters directly, and MHR is the Apache-2.0 body model order 893 turns into a template. With this worker, a user's selfie or full-body photo becomes real head and body shape (order 896) instead of a fixed template with a painted face. It also opens photo-to-pose and video-to-motion later. This order builds a production worker that is complete except for the weights. The weights are gated on Hugging Face, and accepting that licence is the campaign's one owner click.

## Current state (measured 2026-11-21; re-verify)

- Upstream: `facebookresearch/sam-3d-body`. Checkpoints: `facebook/sam-3d-body-dinov3` (840M parameters) and `facebook/sam-3d-body-vith` (631M), both HF-gated. The pipeline uses a human detector (ViTDet, or SAM 3) and a FOV estimator (MoGe-2). Check every one of these transitive models' licences (MoGe-2 code and weights, the detector weights) before using them, and record them. Replace any non-commercial one with a commercially clean equivalent.
- On 2026-11-21, GCP secrets `hf-token` and `hf-token-2` (project `aerial-vehicle-466722-p5`) both returned 403 on both checkpoints. `gs://three-ws-model-weights/` has no `sam3d-body` prefix.
- The house pattern for a gated-weights GPU worker is `workers/model-sam3d-objects/`: `main.py`, `pipeline.py`, `request_policy.py`, `storage_backend.py`, a vendored `worker_security.py`, contract tests (`test_app_contract.py`, `test_request_policy.py`), `Dockerfile`, `entrypoint.sh` (pulls weights from GCS at boot), and `cloudbuild.yaml` (GPU, `--no-gpu-zonal-redundancy`, the build SA `three-ws-build@`, a runtime SA). Staging is `scripts/stage-sam3d-objects.mjs` (`npm run stage:sam3d-objects -- --accept-sam-license`, which refuses without the flag, checks the token, streams HF to GCS, copies the LICENSE, and creates the Artifact Registry repo). Copy this pattern faithfully.
- us-central1 L4 quota is starved, so pick a region with GPU quota (context file).

## Step 0: re-derive the current state

```bash
cat prompts/finish/_context/realism-00-CONTEXT.md
ls workers/model-sam3d-body 2>/dev/null
cat workers/model-sam3d-objects/README.md; sed -n 1,200p workers/model-sam3d-objects/main.py
cat workers/model-sam3d-objects/cloudbuild.yaml workers/model-sam3d-objects/entrypoint.sh
sed -n 1,200p scripts/stage-sam3d-objects.mjs
npm run check:vendored 2>&1 | tail -3
gh api repos/facebookresearch/sam-3d-body --jq '{license: .license.spdx_id, pushed_at}'
gh api repos/facebookresearch/sam-3d-body/contents --jq '.[].name'
HF_TOKEN=$(gcloud secrets versions access latest --secret=hf-token --project aerial-vehicle-466722-p5) curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $HF_TOKEN" https://huggingface.co/api/models/facebook/sam-3d-body-dinov3/tree/main
gsutil ls gs://three-ws-model-weights/ | head -40
```

If the HF check returns 200, the owner has already accepted the licence. Then the live proof below is part of this order, not deferred.

## Tasks

1. **Read upstream fully:** the inference entry point, required inputs (image, optional person boxes, optional camera intrinsics), outputs (MHR parameters: shape, pose, expression, camera translation, and the posed mesh), GPU memory needs, and pinned dependency versions. Record a dependency and licence table in the README. Pin the upstream commit SHA.
2. **Worker** `workers/model-sam3d-body/` (FastAPI) on the sam3d-objects pattern:
   - `POST /v1/body` takes an image URL or upload (size and type limits in `request_policy.py`, private-network URL blocking the same as sibling workers) and optional `person_index` or box. It returns, per detected person: MHR shape (45), pose and expression parameters, camera, 2D keypoints and confidences, plus a GLB of the posed MHR mesh written through `storage_backend.py`. Also add `GET /healthz` and `GET /readyz` (weights loaded).
   - Bearer auth through the vendored `worker_security.py` (byte-identical, per `npm run check:vendored`).
   - Deterministic preprocessing, batch size 1, bf16 or fp16 where upstream supports it, and model warmup at boot. Report the timing in the response.
   - Errors at the boundary: no person found, too many people, image too small or blurred (measure, do not guess thresholds), out-of-memory. Each returns a structured error code the caller can act on.
   - Never call the MHR to SMPL converter. Output stays MHR.
3. **Weights:** `scripts/stage-sam3d-body.mjs` plus the `npm run stage:sam3d-body` script entry (`package.json` is a hot file, so add the entry last). It mirrors `stage-sam3d-objects.mjs` (accept flag, token check, stream to `gs://three-ws-model-weights/sam3d-body/`, copy the LICENSE, Artifact Registry repo, `--dry-run`). Stage every transitive model the pipeline downloads at runtime, so the container never reaches Hugging Face. `entrypoint.sh` pulls from GCS.
4. **Container and build:** `Dockerfile` (CUDA base matching upstream, pinned wheels, non-root user, no weights baked in) and `cloudbuild.yaml` (region with L4 or RTX quota, `--gpu=1`, `--no-gpu-zonal-redundancy`, min instances 0, concurrency 1, the build and runtime service-account pins from CLAUDE.md, `TMPDIR` note in the README).
5. **Tests that run without weights:** contract tests for every route, auth, request policy, error codes and response schema (FastAPI `TestClient` with the model loader behind a real interface that the tests exercise through its no-weights path, which returns `readyz` false and 503 on `/v1/body`). Add a parameter-schema test that checks the response field shapes against MHR's documented dimensions. These are not mocks of the model's output. Never fabricate parameters.
6. **Live proof:**
   - If weights are reachable (HF 200, or already in GCS): stage them, build and deploy the worker (a new unwired service, pre-approved), run three consented test photos from the repo's fixtures (a selfie, a full-body shot, a two-person image), and save the output GLBs and parameters. Load the meshes in the viewer on your dev port. Record latency and GPU memory.
   - If not: build the image through Cloud Build anyway (proves it builds), deploy nothing that cannot start, and write the exact three owner commands (accept on HF, `npm run stage:sam3d-body -- --accept-sam-license`, `gcloud builds submit --config workers/model-sam3d-body/cloudbuild.yaml .`) into the README and the order's Status paragraph.
7. **Docs:** `workers/model-sam3d-body/README.md` (contract, env, licences with SAM attribution text, deploy, cost per call measured or estimated from GPU-seconds), a `STRUCTURE.md` row (hot file, last), `docs/realism/licences.md` rows (create the file if 887 has not), and a changelog entry only if the worker is live (otherwise none, since nothing user-visible changed).

## Definition of done

- [ ] `cd workers/model-sam3d-body && python -m pytest -q` passes. `npm run check:vendored` passes.
- [ ] `npm run stage:sam3d-body -- --dry-run` lists every file it would copy (needs read access) or prints the exact access-request URL (no access).
- [ ] Cloud Build builds the image successfully (build ID in the report).
- [ ] Either a live run on three real consented photos (outputs and timings in the README), or a dated Status paragraph naming the owner's HF click as the only remaining step.
- [ ] Every transitive model and its licence is in the README and in `docs/realism/licences.md`. No SMPL-family code or weights are present.
- [ ] `STRUCTURE.md` row added. `npm run audit:docs` passes.

## Never blocked

- The 403 is the expected state, not a blocker. Everything except the live inference is buildable and testable without weights.
- If a transitive model (detector or FOV) has a non-commercial licence, swap in a commercially clean one already used in the repo (MediaPipe pose for detection boxes, or a detector the sam3d-objects worker already ships) and document the change in quality.
- If L4 quota is unavailable everywhere, use the RTX Pro 6000 lane the sam3d-objects worker uses (check `workers/model-sam3d-objects/cloudbuild.yaml` substitutions and memory `rtx-single-gpu-rollback-trap`).

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Run `npm run check:rules -- --paths <every file you touched>` and fix what it reports.
3. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
4. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/895-realism-09-sam3d-body-worker.md`) and append one dated line to `prompts/finish/_context/realism-PROGRESS.md` (create it if missing): the date, `895-realism-09-sam3d-body-worker.md`, the commit SHAs, and one sentence on what shipped.
5. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/realism-PROGRESS.md`.
6. Never push or deploy to production unless the owner's message that started this session explicitly told you to. The campaign deploy policy (new unwired workers, staging revisions, verify-only Cloud Build runs) is the only exception. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.
