# Fit the user's real head and body shape from their photos onto the MHR template during reconstruction

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

Many sessions may be working in this same worktree at once, including the other `realism-` orders. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Your dev port is **4896** (`npx vite --port 4896 --strictPort`). Edit the hot shared files listed in the context file last, with the smallest possible hook.

## Why this matters

Today reconstruction moves a fixed template's head towards 468 MediaPipe landmarks, then refines it with a bounded displacement field (`dense_fit.py`). The worker's own docs say this closes about 60 percent of the identity gap. The skull, jaw width, face length and body proportions all start from the template, so everyone ends up as a variation of one person. SAM 3D Body predicts MHR's 20 head and 20 body identity parameters from a photo. Applying them to the MHR template before the landmark morph and dense fit means the fine steps start from the person's own head shape. This is the likeness win the realism campaign exists for.

## Prerequisites

- Order 894 (`894-realism-08-recon-template-mhr.md`, which itself needs 893): `RECON_TEMPLATE=mhr` is registered and tested.
- Order 895 (`895-realism-09-sam3d-body-worker.md`): `workers/model-sam3d-body` exists.

Step 0 checks both. If either is missing (no code on disk and no line in `realism-PROGRESS.md`), open that order file and do all of it first, including its close-out, then continue. Never run this order while another session is running 893, 894 or 895.

## Current state (measured 2026-11-21; re-verify)

- `workers/avatar-reconstruction/main.py` `_process_job(job_id, image_sources, body_type)` runs the face pipeline: `face_pipeline.py`, then `face_geometry.py` (landmark morph), `dense_fit.py` (displacement refine, falls back to None on any failure, so a dense step never fails a job), `face_projection.py`, `view_texture.py`, and `glb_ops.py` (`set_head_geometry`, `bake_body_type`).
- Order 893's template stores the MHR shape basis in GLB data, so the worker can apply a 45-dimensional shape vector without `mhr_model.pt`.
- The SAM 3D Body weights may still be gated (HF 403 on 2026-11-21). Check again in Step 0.
- Likeness eval: `scripts/likeness-eval.mjs` (gate 4.0).

## Step 0: re-derive the current state

```bash
cat prompts/finish/_context/realism-00-CONTEXT.md
cat prompts/finish/_context/realism-PROGRESS.md 2>/dev/null
ls workers/avatar-reconstruction/templates/mhr.glb workers/model-sam3d-body/ 2>&1
grep -n "mhr\|MHR" workers/avatar-reconstruction/recon_templates.py
sed -n 100,200p workers/avatar-reconstruction/main.py
grep -n "def " workers/avatar-reconstruction/face_pipeline.py workers/avatar-reconstruction/glb_ops.py | head -40
HF_TOKEN=$(gcloud secrets versions access latest --secret=hf-token --project aerial-vehicle-466722-p5) curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $HF_TOKEN" https://huggingface.co/api/models/facebook/sam-3d-body-dinov3/tree/main
gcloud run services list --project aerial-vehicle-466722-p5 --format='value(metadata.name,status.url)' | grep -i sam3d
```

## Tasks

1. **Shape phase module** `workers/avatar-reconstruction/shape_fit.py`, owned by this order:
   - Calls the SAM 3D Body worker (`SAM3D_BODY_URL` plus a bearer token from env, the same auth pattern as other worker-to-worker calls in this worker) on each input photo. The timeout and retry policy are measured, not guessed.
   - Aggregates the head shape across the selfies. Weight each photo by detection confidence and by face frontality from MediaPipe's pose, and reject outliers (median absolute deviation on each parameter).
   - Applies body shape only when a photo shows the full body with enough confidence. Otherwise it keeps the `body_type` preset. Never invent a body from a headshot.
   - Applies the vector to the MHR template through the GLB shape data (order 893's format), then re-solves the joints and floor offset the same way `bake_body_type` does. The skeleton must match the new proportions so clips and garments still fit.
   - Clamps every parameter to the range in the GLB extras, so a bad prediction cannot produce a deformed body.
   - Returns None on any failure (timeout, no person, worker 503 because weights are not loaded), so the pipeline continues on the template shape exactly as today. The shape phase never fails a job, matching the dense-fit contract.
2. **Pipeline order:** shape fit, then landmark morph, then dense fit, then texture, and only when `RECON_TEMPLATE=mhr` and `SAM3D_BODY_URL` is set. Other templates are unaffected. The hook in `main.py` and `face_pipeline.py` is minimal and goes last (hot file). The job record and result metadata gain a `shape_fit` field (applied, parameters, confidence, latency, or the reason it was skipped), so the eval and the UI can see what happened.
3. **Tests (pytest):** aggregation and outlier rejection on recorded real worker responses (capture them from a live run and commit them as fixtures if the weights are live; otherwise build fixtures from upstream's own published example outputs and cite the source), clamping, joint re-solve keeps skin binding valid, the morph targets and the vertex count and order guarantees still hold after shape plus dense fit, and the None fallback on every failure path. No fabricated parameter vectors: fixtures must come from real model output and say where they came from.
4. **Live proof (when weights are reachable):** stage the weights, deploy the SAM 3D Body worker (new unwired service, pre-approved, if 895 did not), point the staging reconstruction revision at it (`--update-env-vars SAM3D_BODY_URL=...`, pre-approved for staging), and run the likeness eval on the same 10 subjects three ways: wolf3d, mhr without shape fit, and mhr with shape fit. Record all three in `docs/realism/mhr-template.md`. Include side-by-side renders of three subjects.
5. **When weights are not reachable:** everything above except the live eval ships. The code path is proven up to the worker boundary (the worker returns a 503 for unloaded weights, and reconstruction falls back cleanly; show both on staging). Keep this order file with a dated Status paragraph naming the HF click and the exact eval command.
6. **Consent and privacy:** shape parameters are derived biometric data. Store them only inside the user's own avatar record and job result, follow the same retention and deletion as the source photos (find the existing selfie consent and retention code with `grep -rn "consent" api/avatars api/*recon* | head`), and never log raw parameter vectors at info level. Document this in the README.
7. **Docs:** worker README (phase, env vars, fallback), `docs/realism/mhr-template.md` (shape-fit section with numbers), and a changelog entry only when it is live on staging with numbers.

## Definition of done

- [ ] Worker test suites pass, including the new shape-fit tests (pytest output in the report).
- [ ] With the SAM worker unavailable, an MHR reconstruction on staging still succeeds on the template shape, with `shape_fit.skipped` explaining why (job output in the report).
- [ ] Either the three-way likeness table with real numbers and side-by-side renders, or a dated Status paragraph naming the owner's HF click as the only remaining step.
- [ ] Garments and canonical clips still fit a shape-fitted avatar (viewer screenshot) whenever a live run happened.
- [ ] Production env unchanged. Docs and README done. `npm run check:vendored` passes.

## Never blocked

- If upstream publishes no example outputs suitable as fixtures and the weights are gated, build the fixture from the worker's own schema-validated response once the owner clicks. Until then, keep the aggregation tests on synthetic but clearly labelled geometric cases (for example identical vectors, or one outlier among identical vectors), which test the maths without claiming to be model output.
- If the joint re-solve breaks garment fit, reuse `glb_ops.bake_body_type`'s solver rather than writing a second one.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Run `npm run check:rules -- --paths <every file you touched>` and fix what it reports.
3. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
4. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/896-realism-10-identity-shape-fit.md`) and append one dated line to `prompts/finish/_context/realism-PROGRESS.md` (create it if missing): the date, `896-realism-10-identity-shape-fit.md`, the commit SHAs, and one sentence on what shipped.
5. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/realism-PROGRESS.md`.
6. Never push or deploy to production unless the owner's message that started this session explicitly told you to. The campaign deploy policy (new unwired workers, staging revisions, verify-only Cloud Build runs) is the only exception. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.
