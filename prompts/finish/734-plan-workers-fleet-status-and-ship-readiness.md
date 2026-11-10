# One command reports which workers are live versus built-only, with verify builds and tests for each undeployed worker

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/734-plan-workers-fleet-status-and-ship-readiness.md`.

**Priority:** P2, new capability with clear value (score 52 of 100 inside the tier). **Area:** workers. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

About fifteen workers under `workers/` are built but have no Cloud Run service, and each README states "not deployed" in its own words, dated by whoever last looked. Nobody can tell at a glance which claims are still true, which workers would even build today, or what the one-line ship command is. That ambiguity is why finished capability (texture, cad-forge, granite-guardian, robinhood-feed, avatar-pipeline-controller, MoMask motion) sits idle. A generated fleet table plus build-only proofs turns every owner deploy decision into a single command.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `gcloud run services list` shows live: agent-sniper, avatar-reconstruction, garment-forge, model-asl-recognition, model-hunyuan3d (+21, +21-rtx), model-rig, model-text2motion, model-trellis, model-triposg, model-triposr, model-video2motion, okx-chat-bot, rembg-service, remesh-service, segment-service, stylize-service, three-ws-api.
- No service exists for: texture, cad-forge, granite-guardian, avatar-pipeline-controller, robinhood-feed, agent-mm, pump-fun-mcp, agent-crawler, agent-screen-pool, agent-screen-pool, agora-citizens, model-lato2, model-video2scene, modly, agent-gateway (own order), agent-orders (existing order 614), longcat (own order).
- `agent-screen-worker` is intentionally owner-run with no cloudbuild; do not add one.
- `workers/agent-orders/cloudbuild.verify.yaml` is the only build-only verify config in the tree.
- `docs/ops/gcp-model-workers.md` documents only the forge lanes. No script reports fleet-wide deployed state; `scripts/audit-deploy-artifacts.mjs` is unrelated.
- MoMask backend in `workers/model-text2motion` has never had an in-house production run (README lines near 208, weights at `gs://three-ws-model-weights/momask/`).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
gcloud run services list --project aerial-vehicle-466722-p5 --format='value(metadata.name,status.url)' | sort
for d in workers/*/; do n=$(basename $d); printf "%-28s cloudbuild=%s verify=%s tests=%s\n" $n \
  $( [ -f $d/cloudbuild.yaml ] && echo y || echo n ) $( [ -f $d/cloudbuild.verify.yaml ] && echo y || echo n ) \
  $( ls $d | grep -qiE 'test' && echo y || echo n ); done
ls scripts | grep -iE 'fleet|workers'; grep -n '"workers:' package.json
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Write `scripts/workers-fleet-status.mjs` (plain Node, no new dependencies). It enumerates `workers/*`, reads `gcloud run services list --format=json` for the project, matches each directory to its service via the `--service` / service name in that directory's `cloudbuild.yaml`, and prints a table: worker, service, live or not, URL, min and max instances, GPU, last deploy time, has cloudbuild, has verify config, has tests. Add `--json` and `--check` (non-zero exit when a worker whose README claims "deployed" has no service, or the reverse). Add `npm run workers:fleet`.
2. Add `tests/workers-fleet-status.test.js` for the pure parts (service-name extraction from cloudbuild YAML fixtures copied from real worker configs, README claim parsing, table rendering, `--check` exit logic). Feed it recorded `gcloud` JSON captured from the real project, not invented data.
3. For each undeployed worker with a Dockerfile (texture, cad-forge, granite-guardian, avatar-pipeline-controller, robinhood-feed, agent-mm, pump-fun-mcp, agent-crawler, agent-screen-pool, agora-citizens, model-lato2, model-video2scene, modly), add `cloudbuild.verify.yaml` (build-only, pinned `three-ws-build@`, same pattern as agent-orders) plus a narrow `verify.gcloudignore` where the repo-wide context is large. Submit each with Cloud Build and record the result. A GPU worker's verify build is build-only and needs no GPU quota.
4. Where a worker has no tests at all, add the smallest honest suite for its pure logic (request validation, queue and lease logic, response shaping), in the worker's own test layout. Do not mock the model; test the contract around it.
5. Fix every build failure the verify builds expose (stale lockfile, missing COPY, base image drift), test-first where the failure is a code bug.
6. Run `npm run workers:fleet -- --check` and fix each README whose status line disagrees with reality: replace hand-written "not deployed (checked <date>)" with a pointer to the fleet command and keep the worker-specific ship command. Do the same for `workers/README.md`.
7. Generate `docs/ops/workers-fleet.md` from the script (`npm run workers:fleet -- --markdown`), include the ship command per worker and the quota or secret each needs, and link it from `docs/ops/gcp-model-workers.md` and `STRUCTURE.md`.
8. MoMask: write `workers/model-text2motion/scripts/benchmark-momask.mjs` that, against a worker URL passed in, sends the HumanML3D prompt set already referenced in the README, records frame counts, unit-norm check on every quaternion track and latency, and prints a table. Do not deploy; document the exact owner commands to stage weights, deploy the MoMask revision and run the script.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm run workers:fleet` prints a table where every `workers/*` directory appears, and `npm run workers:fleet -- --check` exits 0.
- [ ] `npx vitest run tests/workers-fleet-status.test.js` passes.
- [ ] Each listed worker has a successful Cloud Build verify run recorded in `docs/ops/workers-fleet.md` (build id per worker) or a one-line, evidenced reason it cannot build.
- [ ] `grep -rn "not deployed" workers/*/README.md` returns only lines that point to `docs/ops/workers-fleet.md`.
- [ ] `npm run audit:docs` passes.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| gcloud not authenticated | Follow the GCP row of the self-unblock playbook; the project is aerial-vehicle-466722-p5 |
| A verify build needs more upload than the repo allows | Add a narrow `verify.gcloudignore` as agent-orders does |
| A worker needs GPU quota to build | It does not: verify builds never run the GPU image |
| Missing secrets referenced by a cloudbuild | Verify configs stop before deploy and need no secrets; list the secret names in the fleet doc |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Actual `gcloud run deploy` of any worker is the routine owner deploy gate. Report the ship commands; do not run them.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/734-plan-workers-fleet-status-and-ship-readiness.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `734-plan-workers-fleet-status-and-ship-readiness.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `workers/README.md`
- `workers/deploy/README.md`
- `workers/texture/README.md`
- `workers/cad-forge/README.md`
- `workers/granite-guardian/README.md`
- `workers/avatar-pipeline-controller/README.md`
- `workers/robinhood-feed/README.md`
- `workers/agent-mm/README.md`
- `workers/pump-fun-mcp/README.md`
- `workers/agent-forge/README.md`
- `workers/agent-crawler/README.md`
- `workers/agent-screen-pool/README.md`
- `workers/agora-citizens/README.md`
- `workers/model-lato2/README.md`
- `workers/model-video2scene/README.md`
- `workers/modly/README.md`
- `workers/model-text2motion/README.md`
- `docs/ops/gcp-model-workers.md`
