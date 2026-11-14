# Redeploy the stale GPU worker images that carry already-shipped fixes, and add a drift check so a worker fix cannot sit unbuilt again

**Status (2026-11-04):** The drift check is built and wired: `npm run check:worker-drift` (`scripts/check-worker-drift.mjs`, `scripts/lib/worker-drift.mjs`, `tests/check-worker-drift.test.js`, 24/24 passing, from `58321cec1` and `d346e59a9`) is a documented step 6 of the `deploy-runbook` skill and a section of `docs/ops/gcp-production.md`; it needs gcloud, so it runs on the operator machine rather than as a Cloud Run cron. `model-triposplat` is deployed (`model-triposplat-00003-2pd`, 2026-11-03) and `MODEL_TRIPOSPLAT_URL` is set. What remains belongs to the owner (gate 2, production rollouts): the rebuilds the check prints, in this order: `remesh`, `model-trellis` (then the pre-approved us-east4 image roll), `model-triposg`, `model-text2motion`, `model-hunyuan3d` (three configs), `model-triposr`, `rig`, `segment`, `stylize`, `garment-forge`, plus the first `model-trellis2` deploy and its `--update-env-vars MODEL_TRELLIS2_URL=...`. After they land, a session finishes tasks 3, 4 and 7 (per-service log/job verification, the MoMask vs MDM benchmark, closing OWNER-ACTIONS rows 31, 38, 46, 69 and 71, which carry 2026-11-04 re-measurements).

**Status (2026-11-14):** The 2026-11-04 rollout (source `592750041`) landed `remesh`, `model-trellis` (again on 2026-11-06 as `00033-vkz`), `model-triposg`, `model-text2motion`, `model-hunyuan3d`, `rig`, `segment`, `stylize` and a first `model-trellis2`. Verified and closed: rows 69 (zero `signal 11` on `remesh-service-00006-hxp` in 10 days) and 71 (zero liveness kills on `model-trellis-00033-vkz`); a Wikimedia photo job completed on `model-triposg-00009-z8b` in 49.6 s with a valid GLB. Found and fixed: MoMask could never load (`np.float` removed in NumPy 1.24), fixed test-first in `momask_sampler.py` (landed in `79d907d00`). Still open, all owner-gated rollouts (gate 2): (1) rebuild `model-text2motion` for the MoMask fix, then run `benchmark-momask.mjs` (row 46, task 4); (2) rebuild `rembg` (June image, the last Wikimedia 403 source, row 31); (3) row 38 per its own 2026-11-14 entry (`model-trellis2` serves `00001-s4m`, which cannot load its pipeline, 1024 is host-RAM-killed and us-central1 has no L4 quota, so `MODEL_TRELLIS2_URL` stays unset and Forge correctly falls back to `trellis_selfhost`); (4) the routine rebuilds `npm run check:worker-drift` prints (28 DRIFTED rows as of 2026-11-14, mostly commits from 2026-11-04 to 2026-11-13). The drift check's "every worker current" line can only pass after those rollouts, and new worker commits re-open it, which is the check doing its job. Note: the old row 67 reference in this order is a numbering collision; row 67 is now `PAY_VERDICT_HMAC_KEY`, and the TripoSplat half was already done on 2026-11-03.

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/947-plan-ops-gpu-worker-images-redeploy-and-drift-check.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 78 of 100 inside the tier). **Area:** ops. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Fixes to the Cloud Run worker services are merged in the repo but never reach production because the deploy cadence only covers `three-ws-api`. Concrete live cost: `remesh-service` segfaults ("signal 11") in `_blender_convert` on a revision built 2026-07-16, five weeks before the fix `59d9aa9cd` that already exists; `model-trellis` was killed by its own liveness probe twice in a week and the VRAM recycle guard (`9bbea4c09`) is not in the running image; every image-fetching worker still lacks the descriptive User-Agent that stops Wikimedia reference photos failing with 403; `model-text2motion` runs a July image without the MoMask backend that is built and staged. Nothing today tells anyone a worker image is behind its source, so each of these was found by reading logs. The fix is a one-time redeploy of the drifted workers plus a detector that makes drift visible.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Running images (Cloud Run, project `aerial-vehicle-466722-p5`, us-central1): `remesh-service` revision `remesh-service-00005-8rr` (image tag `1756bc51`, created 2026-07-16); `model-trellis` `model-trellis-00029-697` (tag `manual1790753126`, built about 2026-09-30, before `9bbea4c09`); `model-text2motion` `model-text2motion-00007-4gt` (tag `manual1784819981`, about 2026-07-23, before MoMask); `model-triposg` `model-triposg-00008-bzx` (tag `stage-a1d1ec3`, July); `model-triposr` `model-triposr-00011-rpl` (tag `manual02`); `model-hunyuan3d` `model-hunyuan3d-00022-58s` (tag `959635b78`); `model-rig`, `segment-service`, `stylize-service`, `garment-forge` all July revisions.
- Merged fixes the images lack: `59d9aa9cd` (remesh Blender teardown), `9bbea4c09` (trellis VRAM recycle guard), `d886d09e1` (User-Agent in `worker_security.py`, mirrored to 17 vendored copies), `515d3a683` (every 3D worker refuses glTF buffers pointing outside the payload), `c832c83c3` (cad-forge sandbox policy and texture projection hardening).
- `model-trellis2` does not exist as a Cloud Run service (OWNER-ACTIONS row 38) and `MODEL_TRELLIS2_URL` is unset on `three-ws-api`, so the Forge registry's default image-to-3D lane is unreachable and every request falls to the next lane. `model-triposplat` is likewise undeployed (row 67).
- No detector script exists: `ls scripts | grep -iE 'drift|fleet|worker'` finds `check-cron-drift.mjs`, `check-vendored-workers.mjs`, `audit-deploy-artifacts.mjs` only; none compares a running worker image to its source commit.
- Every `workers/*/cloudbuild.yaml` already pins the `three-ws-build@` service account; deploy command pattern is `gcloud builds submit --config workers/<name>/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5 --substitutions=SHORT_SHA=manual$(date +%s) .` (documented per worker README).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
P=aerial-vehicle-466722-p5
gcloud run services list --project $P --format='table(metadata.name,status.latestReadyRevisionName,metadata.creationTimestamp)'
for s in remesh-service model-trellis model-text2motion model-triposg model-triposr model-hunyuan3d model-rig segment-service stylize-service garment-forge; do
  echo $s; gcloud run services describe $s --region us-central1 --project $P --format='value(spec.template.spec.containers[0].image,status.latestCreatedRevisionName)'
done
git log -1 --format='%h %cI' -- workers/<name>   # per worker: last source change vs revision creation time
gcloud run services describe model-trellis2 --region us-central1 --project $P 2>&1 | tail -2
npm run check:vendored
```

A worker is drifted when its newest source commit (`git log -1 --format=%cI -- workers/<name>` plus the vendored `worker_security.py` copy) is newer than the creation time of its serving revision.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Build `scripts/check-worker-drift.mjs` (and `npm run check:worker-drift`): for each directory in `workers/` that has a `cloudbuild.yaml`, resolve the Cloud Run service name from the file (the `gcloud run deploy` step), read the serving revision's creation time and image tag via `gcloud run services describe --format=json`, compare with `git log -1 --format=%cI -- workers/<name>`, print a table (worker, running revision, built at, last source change, commits behind, DRIFTED/current/NOT-DEPLOYED), and exit non-zero when any deployed worker is drifted by more than a configurable grace (default 7 days). Read-only. Unit-test the comparison and the cloudbuild parser in `tests/check-worker-drift.test.js` with fixture JSON captured from a real `describe` output.
2. Run it and redeploy, one worker at a time, in this order (highest live impact first): `remesh-service`, `model-trellis` (use `cloudbuild.yaml`, or `cloudbuild.ngc.yaml` if that is the active lane per its README), `model-triposg`, `model-text2motion`, then `model-hunyuan3d`, `model-triposr`, `model-rig`, `segment-service`, `stylize-service`, `garment-forge`. Use `gcloud builds submit --config workers/<name>/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5 --substitutions=SHORT_SHA=manual$(date +%s) .` from the repo root. Config-only service changes are pre-approved. The routine production-deploy gate applies to the build/rollout, so if the current instruction is not itself the approval, prepare each command and the drift report and hand over the one command list.
3. After each rollout verify, do not assume: hit the service `/health` with an identity token, run one real job through the public `three-ws-api` lane that uses it (for example a Forge remesh on a small GLB for `remesh-service`; a text-to-motion request with `model: "momask"` for `model-text2motion`; an image-to-3D with a `upload.wikimedia.org` reference photo for `model-triposg`), then read `gcloud logging read` for the service for 10 minutes and confirm no `signal 11`, no `LIVENESS HTTP probe failed`, no 403 on Wikimedia.
4. `model-text2motion` MoMask: run the benchmark the README describes (MoMask vs MDM on the fixed prompt set) and record FID-proxy or latency numbers in `workers/model-text2motion/README.md`; if MoMask is better on the set, make it the default per the README's rule, else leave MDM default and record why.
5. `model-trellis2` and `model-triposplat`: both are code-complete with local suites. Run each worker's own test suite, run `stage-assets.sh` if weights are not at the documented `gs://three-ws-model-weights/` prefix (they are staged for MoMask; check the others), deploy, then set `MODEL_TRELLIS2_URL` / `MODEL_TRIPOSPLAT_URL` on `three-ws-api` with `--update-env-vars` only, and verify with a real `POST /api/forge-splat` on a photo. If a GPU quota or region capacity error blocks the deploy, follow the self-unblock playbook quota row (try the documented standby region/lane) and report the exact error; do not leave the registry pointing at a dead URL.
6. Wire the drift check into ops visibility: add a weekly Cloud Scheduler-backed cron or extend `api/cron/` health output so `/api/healthz` or `docs/ops` lists drifted workers (reuse the script logic as a library function in `scripts/lib/` and call it from the cron only if it can run read-only on Cloud Run without gcloud; otherwise document it as a pre-deploy step in the `deploy-runbook` skill and in `docs/ops/gcp-production.md`).
7. Close the OWNER-ACTIONS rows (31, 38, 46, 67, 69, 71) in `prompts/finish/_context/production-100-OWNER-ACTIONS.md` with DONE dates and evidence once verified. Add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm run check:worker-drift` prints every deployed worker as current (grace 7 days) and exits 0; `node --test tests/check-worker-drift.test.js` passes.
- [ ] `gcloud run services describe remesh-service ... --format='value(status.latestReadyRevisionName)'` is a revision created after 2026-11-03, and a 24h log read shows zero `Uncaught signal: 11`.
- [ ] `model-trellis` log read over 24h shows zero `LIVENESS HTTP probe failed`.
- [ ] A Forge image-to-3D job with a Wikimedia reference photo completes through `model-triposg`.
- [ ] `gcloud run services describe model-trellis2` answers (service exists) and `three-ws-api` has `MODEL_TRELLIS2_URL` (`node scripts/read-service-env.mjs '^MODEL_TRELLIS2_URL$'`), or the report states the exact quota error and the registry still falls back correctly.
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
| `gcloud builds submit` needs a clean worktree or the wrong service account | Follow the `deploy-runbook` skill; always pin `three-ws-build@`; never use the deleted default compute SA. |
| GPU quota or no capacity in us-central1 | Use the worker's documented standby deploy step (the cloudbuild already carries primary and standby); report the exact error text. |
| Weights missing in `gs://three-ws-model-weights/` | Run the worker's `stage-assets.sh`; credits and bucket are pre-approved. |
| Env update would wipe other vars | Only `--update-env-vars`; never `--set-env-vars`. |
| Unsure whether a worker is intentionally frozen | If its source has no commit newer than the revision, it is current; leave it. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/947-plan-ops-gpu-worker-images-redeploy-and-drift-check.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `947-plan-ops-gpu-worker-images-redeploy-and-drift-check.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `workers/model-trellis/instance_health.py`.

- `prompts/finish/_context/production-100-OWNER-ACTIONS.md` (section "Open rows")
- `workers/README.md`
- `workers/model-text2motion/README.md`
