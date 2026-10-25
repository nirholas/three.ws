# 453. `/healthz` reports `world` as `unknown` when it is really `down`, hiding a 3-month-old, 222-occurrence outage from the one dashboard built to show it

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that references a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them: it edits two JS modules, two docs files, and adds a test. It does NOT redeploy, recreate, or touch the `hyperfy-world` Cloud Run service or its domain mapping (see "Why this is not a redeploy order" below).
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before each commit.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.
- Bug fixes are test-first (CLAUDE.md): confirm the existing/new test fails for the stated reason before changing `subsystem-health.js`, then fix, then confirm it passes.

## Why this matters (measured 2026-10-25)

Three independent measurements, taken in this order, establish the finding:

1. **The world has been down, repeatedly, for three months and is still down right now.** Queried the production database directly (`DATABASE_URL` resolves from `.env.local`, same convention `scripts/apply-migrations.mjs` uses):

       node -e "
       require('dotenv').config({path:'.env.local'});
       require('dotenv').config({path:'.env'});
       import('./api/_lib/db.js').then(async (m) => {
         const rows = await m.sql\`select signature, title, detail, count, first_seen, last_seen from ops_alerts where title ilike '%world%' order by last_seen desc limit 5\`;
         console.log(JSON.stringify(rows, null, 2));
       });
       "

   Top row: `title: "World DOWN", detail: "https://world.three.ws/status returned HTTP 404", count: 222, first_seen: 2026-07-21T04:30:00Z, last_seen: 2026-10-25T08:31:59Z`. The world-health cron (`api/cron/world-health.js`, runs every 15 minutes per `vercel.json`) has been correctly detecting and alerting on this for three months. This is not a blip.

2. **`/healthz` cannot show it.** `curl -s https://three.ws/api/healthz` reports the `world` subsystem as `{"status":"unknown","detail":"no world-health report yet"}` even though the cron ran 4 minutes earlier (confirmed via `gcloud scheduler jobs describe cron--api-cron-world-health --location=us-central1`, `lastAttemptTime` within the last 15-minute window, `status: {}` meaning the HTTP call itself succeeded). Invoking the cron's own endpoint directly with its scheduler secret (pulled from the scheduler job's own `httpTarget.headers.Authorization`, which is visible to anyone with `gcloud scheduler jobs describe` access) proves the cron does see and report the failure:

       curl -s -H "Authorization: Bearer <the scheduler job's own bearer secret>" \
         "https://three-ws-api-lp642k3kpa-uc.a.run.app/api/cron/world-health"
       # => {"status":"down","protected":null,"blueprintCount":0,"reason":"HTTP 404"}

   So the cron computes `down` correctly, in 200ms, and `/healthz` still says `unknown`. Root cause, read from the code: `checkWorld()` in `api/_lib/ops/subsystem-health.js:332` has exactly one source of truth, an ephemeral Redis-backed cache key (`WORLD_HEALTH_CACHE_KEY = 'world:health'`, 1-hour TTL) the cron writes with `await cacheSet(...).catch(() => {})` (`api/cron/world-health.js`, three call sites, all swallow the error). `api/_lib/cache.js` documents its own production failure mode in detail: a SET-failure-streak circuit (`SET_FAIL_THRESHOLD = 5` consecutive failures suppresses ALL writes for `SET_SUPPRESS_MS = 60_000`, falling back to a **per-instance** in-memory map) plus a `totalSetFailures` counter that `/healthz`'s own `cache` subsystem reports as 67 and climbing. Cloud Run runs multiple instances; a SET that falls back to instance A's memory is invisible to the instance that later serves the `/healthz` read. Any write that lands during a suppression window, or on an instance that later scales down, produces exactly the symptom measured: a durable, 222-times-confirmed `down` state reported as `unknown`.

3. **The underlying Cloud Run service is genuinely gone, not crashing.** `gcloud run services list --project=aerial-vehicle-466722-p5` (50 services, every region) has no `hyperfy-world`. The Cloud Run audit log confirms why:

       gcloud logging read 'resource.type="cloud_run_revision" AND protoPayload.methodName="google.cloud.run.v1.Services.DeleteService" AND protoPayload.resourceName:"hyperfy-world"' --project=aerial-vehicle-466722-p5 --freshness=90d --format=json

   `2026-10-23T02:48:38Z`, `principalEmail: nich@sperax.io` (the project's own owner account), `DeleteServiceRequest` for `namespaces/aerial-vehicle-466722-p5/services/hyperfy-world`. **The owner deleted the service two days ago**, presumably after three months of an unresolved, repeatedly-alerting outage (the 222-count alert started 2026-07-21, long before the deletion). `gcloud beta run domain-mappings list` still shows `world.three.ws -> hyperfy-world` with `status: True`, i.e. the DNS/domain mapping is orphaned: it points at a route that no longer exists, so every real visitor to `https://world.three.ws` gets Google's bare, unbranded `Error: Page not found` HTML (verified live, `curl -s https://world.three.ws/` and `/status` both return it) instead of anything three.ws-branded.

## Why this is not a redeploy order

The owner's own account deleted `hyperfy-world` deliberately, two days ago, after the exact failure this order is about had been alerting for three straight months. Recreating it would second-guess a recent, explicit owner infrastructure decision this order has no basis to override. **Do not run `deploy/world/apply-hardening.sh`, do not recreate the `hyperfy-world` Cloud Run service, and do not touch the `world.three.ws` domain mapping** (`gcloud run domain-mappings` / `gcloud beta run domain-mappings`) in this order. The work here is entirely about making the platform's own monitoring and documentation tell the truth about a state that already exists, which is valuable regardless of whether the owner ever redeploys the world:

- Right now, nobody who checks `/healthz` (or any dashboard built on it) can see that `world` is down; they see `unknown`, which reads as "monitor hasn't run yet," not "has been failing for three months."
- `STRUCTURE.md` and `deploy/world/README.md` both still claim the service is "Live," which is false and will mislead the next engineer (or agent) who reads them before touching anything in `deploy/world/`.

## Tasks

1. **Fix the masking in `checkWorld()`** (`api/_lib/ops/subsystem-health.js:332`). When the Redis-backed cache entry is missing or stale (the existing `!parked`/`age > WORLD_STALE_MS` branches), fall back to the durable signal that already exists instead of reporting `unknown`: query `ops_alerts` for the most recent row whose `signature` matches the world-health cron's own alert signatures (`world-health:status-http`, `world-health:status-unreachable`, or derive them the same way `signatureOf()` in `api/_lib/alerts.js` does, since the cron passes a raw `signature` string in `opts.signature` which bypasses the hash (read `sendOpsAlert` closely: when `opts.signature` is set, `sig = signatureOf(opts.signature)`, so the hash of the literal string `'world-health:status-http'` is the stored value; compute it once and compare)). If that row's `last_seen` is recent (within, say, `2 * 15 minutes` plus slack, matching the cron cadence), report `status: 'down'` with the alert's own `detail` text instead of `unknown`. If no such row exists or it is stale too, `unknown` remains correct (the cron genuinely has not reported anything recently, which is the one case this status is honest). Add the DB query using the same `sql` import `api/_lib/alerts.js` already uses (`import { sql } from '../db.js'` or whatever that file's exact import is; read it first), wrapped in the same fail-soft pattern every other subsystem checker in this file uses (a DB read failure must degrade to the existing cache-only behavior, never throw and take down `/healthz` itself).
2. **Add a regression test** beside the existing subsystem-health tests (grep `tests/` for `subsystem-health` or `healthz` to find the right file and existing mocking pattern for `cacheGet`/DB calls) that: (a) reproduces today's bug, mocking `cacheGet` to return null and asserting the OLD code would say `unknown` even when a fresh `ops_alerts` row says otherwise, then (b) asserts the fixed `checkWorld()` returns `down` in that scenario, and (c) asserts it still returns `unknown` when neither source has anything recent. Confirm the test fails against the pre-fix code for the stated reason before applying the fix (bug-fixes-test-first).
3. **Correct the stale "Live" claims.** `STRUCTURE.md:277` currently reads `Live · hyperfy-world on Cloud Run`. Rewrite that cell to state the measured reality with the date: the Cloud Run service was deleted 2026-10-23 (owner action, confirmed via Cloud Run audit log), `world.three.ws` currently 404s, and the health monitor/cron remain in place for if/when it is redeployed. Do the same for `deploy/world/README.md`'s opening paragraph (currently states it "runs as its own Cloud Run service" in the present tense) and anywhere else `grep -rln "hyperfy-world\|world.three.ws" docs/ STRUCTURE.md deploy/world/` turns up a present-tense "it is live" claim that is now false. Do not delete the deploy config or the runbook; a future redeploy still needs them, and that decision belongs to the owner.
4. **Re-run the step 0 cron probe** after your fix ships to confirm `checkWorld()`'s new DB fallback actually reflects the live `ops_alerts` row (you cannot force `/healthz` on production to pick up a local code change, so verify this with a local/unit-level call: import `subsystem-health.js`'s `checkWorld` directly, or whatever export the file provides, in a one-off `node -e` script against the same `DATABASE_URL`, and confirm it returns `down` right now given the 222-count row measured above).

## Definition of done

- [ ] `checkWorld()` in `api/_lib/ops/subsystem-health.js` falls back to a durable `ops_alerts` read when the Redis-backed cache is empty/stale, and the new test (added in the same commit) proves it: fails before the fix, passes after.
- [ ] `npm run test:core` (or at minimum the new/touched test file via `npx vitest run <file>`) passes; no change to any other file's test outcomes.
- [ ] `STRUCTURE.md` row 277 (world/Hyperfy) and `deploy/world/README.md`'s opening description no longer claim the service is "Live" in the present tense; both state the dated, measured reality and cite this order's number.
- [ ] `grep -rn "hyperfy-world" STRUCTURE.md deploy/world/README.md` shows no remaining unconditional "Live"/"runs as" present-tense claim.
- [ ] `npm run check:rules -- --paths <files you touched>` exits 0.
- [ ] No change to any Cloud Run service, Cloud Scheduler job, or domain mapping. `gcloud run services list` / `gcloud beta run domain-mappings list` output is identical before and after (confirm with a before/after diff in the report).
- [ ] One commit for the code+test fix, one commit for the docs fix (or combined if the diff is small and one message honestly describes both).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| `DATABASE_URL` does not resolve | Read it the same way `scripts/apply-migrations.mjs` does: `.env.local` then `.env` then `process.env`. It resolved in this session's measurement above; if it genuinely does not resolve for you, say so as a one-line finding, do not block the docs/cache-fallback-logic work on it (the test can mock the DB call instead of hitting it live). |
| The scheduler job's bearer secret is not visible to you | `gcloud scheduler jobs describe cron--api-cron-world-health --project=aerial-vehicle-466722-p5 --location=us-central1 --format=json` prints it in `httpTarget.headers.Authorization`; if your `gcloud` auth lacks permission, skip the live cron probe and trust the `ops_alerts` count (222) and the `/healthz` response alone, both already measured above. |
| You are tempted to "just redeploy the world since the code is all there" | Do not. The owner deleted the service two days ago after three months of this exact alert; that is a decision, not an accident left for this order to correct. Stay scoped to monitoring/docs truth. |
| `ops_alerts` has no recent `world`-signed row by the time you run this (the owner redeployed, or the signal rotated out) | Good, re-measure `/healthz` fresh; if `world` now reports `ok`/`down` correctly without your fix, the masking bug may still exist for the next multi-day gap, so ship the fallback logic anyway (it is correct regardless of today's exact state) and say in the report that the live symptom had already cleared by the time you checked. |
| The exact signature string the cron passes does not hash to what you expect | Read `api/cron/world-health.js`'s three `sendOpsAlert(...)` call sites for the literal `signature:` values it passes, and `signatureOf()` in `api/_lib/alerts.js` for how they are hashed; compute, do not guess. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths, each subject describing that diff (e.g. `fix(ops): stop /healthz masking a 3-month world.three.ws outage as unknown`).
3. If every line passes, delete this file in the final commit (`git rm prompts/finish/453-auto-world-health-masked-down-state.md`) and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHAs.
4. Final report, in this order: the three step-0 measurements reproduced with their output; the fix and its test (fail-before, pass-after); the docs diff; confirmation that no GCP infra changed; one-line judgment calls. No trailing questions.
