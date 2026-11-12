# Retire the deleted world.three.ws surface with a reversible "retired" health state so healthz, alerts, links and docs match reality

**Status 2026-11-12:** Shipped and live. Production `/api/healthz` lists `world` as `retired` (not in the degraded rollup), the `20261104220000_world_retired_flag.sql` migration is applied (the `app_flags.world_retired` row exists), `ops_alerts` holds 0 open `world-health:*` rows, the Cloud Run domain mapping is gone, and the 4 retirement test files pass (109 tests). Remaining, owner: (1) drop the `world.three.ws` CNAME (`ghs.googlehosted.com`) at the DNS provider; (2) unrelated to this order, sync the 6 Cloud Scheduler jobs `check-cron-drift` reports missing (indexnow-reconcile, microsoft-leads, microsoft-alerts, microsoft-partner-center, m365-connector-sync, creation-describe) with `node scripts/create-gcp-scheduler.mjs --env-file <prod env>`. Once the DNS record is gone, delete this order.

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/271-plan-ops-world-health-retired-state.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 68 of 100 inside the tier). **Area:** ops. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`GET https://three.ws/api/healthz` reports `subsystems.status: "down"` and lists `world` as `down` with detail `HTTP 404` (degraded list today: `rpc_lanes`, `world`, `three_token_rail`, `sniper`). The owner deleted the `hyperfy-world` Cloud Run service on 2026-10-23 on purpose (a deliberate API delete, not drift; `deploy/world/README.md`, OWNER-ACTIONS row 68, which asked "redeploy or formally retire"), yet `api/cron/world-health.js` keeps probing `https://world.three.ws/status` and keeps raising recurring `ops_alerts` (the table holds about 776k rows). A permanent false "down" trains everyone to ignore the rollup, hides real outages behind the same red status, and spams alerts. The platform needs an explicit lifecycle state ("retired") that probes honour, so a down rollup always means something. The correct default is to retire the surface cleanly and reversibly: the monitor code and the `deploy/world/` restore kit stay so the world can come back with a flag flip plus one command. The repo has no product link to the world.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `curl -s -o /dev/null -w '%{http_code}' https://world.three.ws/` returns 404. `/api/healthz` `subsystems` includes `{"name":"world","label":"world.three.ws (Hyperfy)","status":"down","detail":"HTTP 404"}`; `three_token_rail` is down for unset treasury and rewards wallets (owner-pending, out of scope); `sniper` and `rpc_lanes` are degraded.
- `api/_lib/forge-health.js` `probeWorld()` HEADs `${WORLD_URL || 'https://world.three.ws'}/status`; any non-OK maps to `down`. No retired or decommissioned concept exists.
- `api/_lib/ops/subsystem-health.js` `checkWorld()` (line ~368) reads the parked `world:health` cache key (`WORLD_HEALTH_CACHE_KEY`, `WORLD_DOWN_SIGNATURES`) or a recent alert (`world-health:status-http`, `world-health:status-unreachable`) and maps it to `down`/`unknown`. No retired state.
- `api/cron/world-health.js` probes `WORLD_URL` every 15 minutes, runs an asset sweep and an unprotected-world check, and alerts via `sendOpsAlert`. It is registered in `vercel.json` at the `api/cron/{uptime-check,world-health,quota-check}.js` entry (line 80) and the crons array; a Cloud Scheduler job drives it.
- Other references to `world.three.ws`: `scripts/gcp-triage.mjs`; tests `tests/subsystem-health.test.js`, `tests/world-health-asset-sweep.test.js`, `tests/api/forge-health.test.js`, `tests/api/forge-cache-headers.test.js`; docs `ARCHITECTURE.md` (~172, ~1881), `docs/ALL.md` (~5572, ~8537; check whether it is generated by a script before editing by hand), `docs/ops/ISSUES.md` (~38), `docs/ops/gcp-credits.md` (~1426), `STRUCTURE.md` row "Multiplayer 3D world (world.three.ws)". The status page is `pages/status.html`.
- `deploy/world/` holds the full restore kit (`Dockerfile`, `cloudbuild.yaml`, `cloudrun.yaml`, `apply-hardening.sh`, `patches/`, `README.md`), which documents the deletion and that "the cron keeps alerting".
- The Cloud Run domain mapping for `world.three.ws` was still provisioned on 2026-10-24 and points at nothing. No in-product page links to the world (grep of `pages/` and `src/` finds nothing outside the files above); check `data/pages.json` and the sitemap too.
- Runtime flags exist: `api/_lib/flags.js` (`isFlagEnabled`, `getFlag`, `setFlag`, `KNOWN_FLAGS`, table `app_flags`; a flag falls back to its env var when no row exists, reads fail soft, and a toggle propagates within 30 s), documented in `docs/ops/runtime-flags.md`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```sh
cd /home/user/three.ws
curl -s https://three.ws/api/healthz | python3 -c "import json,sys;d=json.load(sys.stdin)['subsystems'];print(d['status'],d['degraded']);print([(s['name'],s['status'],s.get('detail')) for s in d['subsystems'] if s['status']!='ok'])"
curl -s -o /dev/null -w '%{http_code}\n' https://world.three.ws/
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
gcloud run services describe hyperfy-world --region us-central1 --project aerial-vehicle-466722-p5 2>&1 | tail -2
gcloud beta run domain-mappings list --region us-central1 --project aerial-vehicle-466722-p5 2>&1 | grep -i world
grep -rn "retired\|WORLD_RETIRED" api/_lib/ops api/_lib/forge-health.js api/cron/world-health.js | head
grep -rIl 'world\.three\.ws\|world-health\|WORLD_HEALTH\|world:health\|probeWorld' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . | head -40
head -40 deploy/world/README.md
ls tests | grep -iE "subsystem-health|forge-health|world-health"
npm run db:status
```

If `hyperfy-world` exists again (someone redeployed, `/status` returns 200), the order is moot: confirm `world` reads `ok`, record that and stop. If a `retired` status already exists and healthz excludes `world` from the rollup, mark this order shipped and stop.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Tests first: add `tests/subsystem-health-retired.test.js` (and extend `tests/subsystem-health.test.js`) covering (a) retirement flag set and the parked/alert state says unreachable: `world` is returned with `status: "retired"` and a `detail` stating the date and why (retired 2026-10-23, restore with `bash deploy/world/apply-hardening.sh`), is excluded from `counts` and from the rollup `status`, and the rollup stays `ok` when everything else is ok, (b) flag unset and probe 404 gives `down` exactly as today, (c) `api/cron/world-health.js` makes no fetch and emits no alert when retired. Run, watch (a) and (c) fail on current code, then implement.
2. Add a first-class `retired` status to the subsystem model in `api/_lib/ops/subsystem-health.js`: a retired subsystem is listed, never counts toward `down`/`degraded`, never raises an alert, and ignores stale `ops_alerts` fallbacks.
3. Drive retirement from a runtime flag read through `api/_lib/flags.js` (register `world_retired` in `KNOWN_FLAGS` with env fallback `WORLD_RETIRED`; one `setFlag` call or one env change flips it back if the world returns). Default it to retired via an idempotent migration or seed under `api/_lib/migrations` matching what the owner did on 2026-10-23 (run `npm run db:status` first; `npm run db:migrate` applies immediately), and also set `WORLD_RETIRED=1` on the API service with `--update-env-vars` only (never `--set-env-vars`; config-only, pre-approved) so the fallback agrees if the flags table is unreachable.
4. Make `api/cron/world-health.js` and `probeWorld()` in `api/_lib/forge-health.js` short-circuit when retired: no network probe, no alert, and park a `retired` outcome so the gatherer does not fall back to stale alerts. Keep the cron route, its `vercel.json` entry and the Scheduler job in place (the route still exists, so the job does not 404, and un-retiring needs no redeploy of the schedule).
5. Render it: add `retired` to every consumer that switches on status values (grep `'degraded'` across `api/`, `src/`, `pages/status*`, `/api/healthz`, ops dashboard, `/nvidia` fleet table if it lists the world, `scripts/gcp-triage.mjs` and other `scripts/` health checks), as a neutral grey badge on `pages/status.html` reading "Retired 2026-10-23" with the restore hint. Audit every user-visible link to `world.three.ws` (`grep -rn "world:health\|probeWorld\|world.three.ws" api src pages scripts`) and hide or repoint any that 404s. Cover the new value in the same test file.
6. Resolve the stale alerts: close the open `world-health:*` rows in `ops_alerts` once (reversible update scoped to those signatures: set `acknowledged_at = now()` and `acknowledged_by = 'world-retirement'` where `signature like 'world-health:%' and acknowledged_at is null`; columns per `api/_lib/migrations/20260712000000_ops_alerts.sql`). Report how many rows were open.
7. Domain mapping: remove the dangling `world.three.ws` Cloud Run domain mapping only after confirming no service is behind it (reversible by re-creating it), and note the DNS record to drop in the report (the DNS is outside the repo).
8. Docs: mark the world as retired (2026-10-23, deleted by the owner) in `deploy/world/README.md`, replacing "the cron keeps alerting" with the flag procedure and keeping the restore command (`bash deploy/world/apply-hardening.sh`) and the un-retire steps (unset the flag, redeploy the service); fix the stale sections in `STRUCTURE.md`, `ARCHITECTURE.md`, `docs/ALL.md`, `docs/ops/ISSUES.md`, `docs/ops/gcp-credits.md`; document the flag in `docs/ops/runtime-flags.md`. Mark OWNER-ACTIONS row 68 DONE with the evidence. Add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/subsystem-health-retired.test.js tests/subsystem-health.test.js tests/world-health-asset-sweep.test.js tests/api/forge-health.test.js` passes; the new retired cases failed before the change.
- [ ] After the next routine deploy, `curl -s https://three.ws/api/healthz` shows `world` as `retired` and not in `degraded` or `down`; the remaining down subsystem is only `three_token_rail` (owner-pending), and other genuinely degraded subsystems may remain.
- [ ] Flipping the flag off (a documented one-line command) restores `down` on a 404, shown in a test.
- [ ] `pages/status.html` renders the retired badge in a real browser with no console errors.
- [ ] `ops_alerts` has zero rows with `acknowledged_at is null` and `signature like 'world-health:%'`.
- [ ] `grep -rn "world.three.ws" pages src api | grep -v retired` shows no un-gated user-facing link to the deleted service, and `deploy/world/` is intact.
- [ ] `node scripts/check-cron-drift.mjs` is clean.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Unsure whether the owner wants the world back | The flag makes retirement reversible and `deploy/world/` stays as a one-command restore; default to retired per the deliberate 2026-10-23 deletion. State the judgment call in one line of the report |
| `app_flags` table or migration questions | Run `npm run db:status` first, add an idempotent migration under `api/_lib/migrations`, then `npm run db:migrate` |
| Status consumers switch on a closed enum | Add `retired` to every switch found by the grep and cover it in the test file |
| Cron drift checker complains | Keep the route and the crons-array entry consistent; run the checker until clean |
| No production access to verify | Verify with the unit tests and a local `handler()` call; the live check happens after the owner deploys |
| Domain mapping or Scheduler commands time out | Retry with `--project aerial-vehicle-466722-p5`; the code work does not depend on them |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/271-plan-ops-world-health-retired-state.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `271-plan-ops-world-health-retired-state.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `api/cron/world-health.js`, `api/_lib/ops/subsystem-health.js`.

- `docs/ops/ISSUES.md`
- `docs/ops/production-sweep-2026-09-15.md`
- `docs/ops/site-health-audit-2026-09-15.md`
- `prompts/finish/_context/production-100-OWNER-ACTIONS.md` (section "Open rows")
- `deploy/world/README.md`
