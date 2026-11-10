# Bring the Granite Guardian lane live on Cloud Run so every IBM claim is true

**Status (2026-11-04):** Step 0 re-measured production unchanged: `POST /api/guardian/assess` 503 `guardian_unconfigured`, `/api/ibm/galaxy` `watsonx_not_configured`, no `granite-guardian` service in europe-west4, no `WATSONX_*` or `GRANITE_GUARDIAN_*` on `three-ws-api` (revision 00523-gvf). Done in 412c90e46: task 6, the `granite_guardian` healthz subsystem (down in production while unconfigured, `/health` probe of the self-hosted lane, degraded when only watsonx can answer), test-first with 7 cases against a real local upstream, health 48/48 and guardian suites green; the worker's `cloudbuild.yaml` no longer passes `--disable-log-requests`, which vLLM v0.29.0 removed (the September build died at weight staging, so the deploy step never ran and the bad flag was never seen); tasks 7 and 8 (docs/ibm.md, docs/ibm-event-offer-map.md, worker README, changelog). Remaining, owner: the GPU build submit was refused by this session's permission classifier, so run `gcloud builds submit --config workers/granite-guardian/cloudbuild.yaml --region europe-west4 --project aerial-vehicle-466722-p5 --no-source` (up to an hour on first run: 16 GB weight stage), then `gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --update-env-vars GRANITE_GUARDIAN_URL=<service url>`, then `node scripts/verify-granite-guardian.mjs` and the production checks in tasks 5 and 6 (`granite_guardian` turns ok after the next deploy of `main`).

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/279-plan-ibm-granite-guardian-lane-live.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 58 of 100 inside the tier). **Area:** ibm. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The IBM partner docs promise live Granite behavior (moderation verdicts on agent identity, the galaxy view, the oracle, attestation), but no IBM model serves in production. `/api/ibm/galaxy` answers `watsonx_not_configured` and `/api/guardian/assess` answers `guardian_unconfigured`. The offer map says it plainly: until one lane lands there is no Granite claim, no live Granite beat and no `@IBM` tag. The self-hosted lane (Granite Guardian on vLLM on a Cloud Run L4 GPU) is fully written (`workers/granite-guardian/`) and paid for by the standing GCP credits approval, but has never been deployed. Deploying it is config plus one build, and it also makes the agent identity gate (`/api/agents/identity-check`) a real check instead of a silent allow.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `curl -s https://three.ws/api/guardian/assess` returns 503 `guardian_unconfigured`; `curl -s https://three.ws/api/ibm/galaxy` returns `watsonx_not_configured`.
- `gcloud run services list --project aerial-vehicle-466722-p5` shows no `granite-guardian` service. The `three-ws-api` env has no `WATSONX_API_KEY`, `WATSONX_PROJECT_ID` or `GRANITE_GUARDIAN_URL`.
- Code is complete: `api/guardian/assess.js` (503 when `!cfg.configured`), `api/_lib/granite-guardian.js`, `api/_lib/watsonx.js`, `api/agents/identity-check.js` (treats unconfigured as allowed), `workers/granite-guardian/` (Dockerfile, `cloudbuild.yaml` with `--gpu=1 --gpu-type=nvidia-l4`, README), `scripts/verify-granite-guardian.mjs`, `tests/api-guardian.test.js`, `tests/api-guardian-assess.test.js`.
- Deploy command (from the worker README): `gcloud builds submit --config workers/granite-guardian/cloudbuild.yaml --region europe-west4 --project aerial-vehicle-466722-p5 --no-source`. Wiring: `gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --update-env-vars GRANITE_GUARDIAN_URL=$URL`.
- The watsonx.ai hosted lane (`WATSONX_API_KEY`, `WATSONX_PROJECT_ID`) needs an IBM Cloud account the owner holds; it is optional once the self-hosted lane is up.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
curl -s -o /dev/null -w "%{http_code}\n" https://three.ws/api/guardian/assess
curl -s https://three.ws/api/ibm/galaxy | head -c 300
gcloud run services list --project aerial-vehicle-466722-p5 --format='value(metadata.name,status.url)' | grep -i guardian
gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep -iE "WATSONX|GUARDIAN"
npm test -- tests/api-guardian.test.js tests/api-guardian-assess.test.js
```

If a `granite-guardian` service already exists and `GRANITE_GUARDIAN_URL` is set, skip to task 3.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read `workers/granite-guardian/README.md` and `cloudbuild.yaml`; confirm the weights path (`_WEIGHTS_PATH`, `_HF_REPO`) and the L4 GPU quota in the chosen region (`gcloud compute regions describe europe-west4`, or the Cloud Run GPU quota page via `gcloud alpha`). If the quota is zero, request the increase from the CLI where possible and fall back to another L4 region the plan allows (`docs/ops/gcp-credits-plan.md`).
2. Run the build and deploy with the command above (build and runtime service accounts are pinned in the cloudbuild file; do not use the deleted default compute SA). Record the service URL. Keep `--min-instances` at the value that keeps first-token latency usable for live use, and set the `lane=guardian-gpu` label already in the file.
3. Run `node scripts/verify-granite-guardian.mjs` against the new URL. It must show a benign prompt classified safe and a clearly harmful prompt flagged, with real logprob scores. Save the output summary for the changelog.
4. Wire it: `gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --update-env-vars GRANITE_GUARDIAN_URL=<url>`. Never use `--set-env-vars`. Confirm the new revision is healthy via `curl -s https://three.ws/api/healthz`.
5. Verify end to end in production: `POST https://three.ws/api/guardian/assess` with a benign and a harmful string returns a verdict (not 503). `POST /api/agents/identity-check` with a signed-in session returns `configured: true`.
6. Make the unconfigured state visible instead of silent: add a `granite_guardian` entry to the subsystem list in `api/_lib/ops/subsystem-health.js` (status `down` when neither `GRANITE_GUARDIAN_URL` nor the watsonx pair is set in production, `ok` when a cheap `/health` probe passes). Test first in the existing ops-health test file.
7. Update `docs/ibm-event-offer-map.md` and `docs/ibm.md` so the "No IBM model is serving in production" statements reflect the measured state, with the date and the verification output. Leave the hosted watsonx lane described as optional.
8. Add a `data/changelog.json` entry, then `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `curl -s -X POST https://three.ws/api/guardian/assess` with a valid body returns 200 and a verdict object, not `guardian_unconfigured`.
- [ ] `gcloud run services list --project aerial-vehicle-466722-p5` lists `granite-guardian` with a ready revision.
- [ ] `node scripts/verify-granite-guardian.mjs` exits 0 against the live URL.
- [ ] `/api/healthz` shows `granite_guardian` ok.
- [ ] `docs/ibm-event-offer-map.md` no longer claims no IBM model is serving, and cites the measurement date.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| L4 GPU quota is zero in the region | File the quota request with `gcloud` where supported, deploy in any region where quota exists (the worker is region-agnostic), and note the region in the docs |
| Weights download needs a Hugging Face token | Check Secret Manager (`gcloud secrets list`) and the worker README for the existing secret; the build already pulls them to a bucket path |
| Cold start too slow for a live demo | Raise `--min-instances` to 1 for the event window and drop it back afterward with `--update-env-vars`-style config-only updates; the credits plan approves GPU spend |
| No watsonx API key | Not needed. The self-hosted lane satisfies the unconfigured state; leave `WATSONX_*` unset |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/279-plan-ibm-granite-guardian-lane-live.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `279-plan-ibm-granite-guardian-lane-live.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/ibm-event-offer-map.md`
- `docs/ibm.md`
- `workers/granite-guardian/README.md`
