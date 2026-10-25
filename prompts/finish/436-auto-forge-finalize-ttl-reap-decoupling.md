# 436. Decouple the forge-finalize TTL reap from the live poll so a slow lane stops burying the whole backlog

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix: follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Write the failing test first, confirm it fails for the stated reason, then fix the code, then confirm it passes. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-25)

`api/cron/forge-finalize.js` is the cron (Cloud Scheduler job `cron--api-cron-forge-finalize`, schedule `* * * * *`, confirmed `ENABLED` with a `lastAttemptTime` seconds old) responsible for finishing or killing every `forge_creations` row stuck in `status = 'generating'`. It is failing to do that job for the overwhelming majority of rows, live in production right now:

    npm run forge:errors -- --days 1
    # 786 generations, done 2, failed 26, still running 758 (96.4%)

Direct read-only query against the production database (same `DATABASE_URL` pattern `scripts/forge-error-report.mjs` uses) confirms this is not a reporting-window artifact:

    select status, count(*) from forge_creations where created_at > now() - interval '2 days' group by status;
    -- generating: 780   done: 31   failed: 202

780 rows sit in `generating`. 746 of them (96%) are already over 1 hour old; median age is roughly 11 hours; the oldest is over a day old. The code's own `HARD_TTL_MINUTES` constant (line ~78) says any non-terminal generation past 45 minutes is dead and should be reaped. It is not being reaped anywhere close to that TTL. When a row does finally resolve, the logged reason gives away the real elapsed time:

    select id, backend, error from forge_creations where status='failed' and error ilike '%timed out%' order by updated_at desc limit 3;
    -- "generation timed out after 1458 minutes"
    -- "generation timed out after 1424 minutes"
    -- "generation timed out after 1429 minutes"

1400+ minutes (close to 24 hours) against a documented 45-minute TTL. A second, independent symptom of the same root cause: 192 rows with `backend IS NULL AND path IS NULL` (the `rerig` / auto-rig lane, envelope mode `rerig` pointing at the `model-rig` worker) have been sitting in `generating` continuously since 2026-10-24T03:37, growing in real time with the query re-run moments apart, and **zero of them have ever resolved**, even though `model-rig`'s own `/health` answers `200` in under 0.3s (`curl https://model-rig-lp642k3kpa-uc.a.run.app/health` returns `{"ok":true,...,"model_loaded":true}`) and a direct poll of a real stuck task id answers in 0.3s too. The worker is not the problem; the rows never get a turn.

Root cause, traced through the code rather than guessed:

1. The sweep query (`api/cron/forge-finalize.js`, the `sql` call right after `export default wrapCron(...)`) is `select ... where status = 'generating' and ... order by created_at asc limit ${BATCH_LIMIT}` with `BATCH_LIMIT = 25`. Oldest rows always win the batch. With 780 `trellis_selfhost` rows far older than any `rerig` row, the batch is permanently monopolized by the backend that is already failing, so the 192 `rerig` rows never get selected at all. This is the direct cause of their 100% stall rate.
2. Every selected row still gets a **live poll** (`gcp.status(row.replicate_job_id)`, up to 15s x 2 attempts, `api/_providers/gcp.js`) *before* the code falls through to the `if (ageMinutes > HARD_TTL_MINUTES)` reap check at the bottom of `sweepRow`. The reap is real and correct (it is exactly what produced the "timed out after 1458 minutes" rows above) but it is gated behind that poll on every single row, every single tick.
3. `wrapCron`'s own budget is 60000ms for this cron (`export const maxDuration = 60;` at the top of the file). With `ROW_CONCURRENCY = 8` and `BATCH_LIMIT = 25`, a batch needs roughly `ceil(25/8) = 4` waves; against an unhealthy lane where each poll burns close to its full 15s x 2 = 30s cap, 4 waves is up to 120s, double the declared budget.
4. `wrapCron` (`api/_lib/http.js`, the `budget`/`runHandler` race around line 854) races the handler against a timer and answers the HTTP request with a 503 the instant the timer wins, **but does not and cannot cancel the in-flight handler** ("Node cannot preempt arbitrary async work without an AbortSignal threaded through every I/O call inside the handler, so the handler itself is never cancelled when the budget wins the race" is the exact comment on that line). The handler keeps running as a detached promise after the response is sent.
5. `three-ws-api`'s Cloud Run revision has `run.googleapis.com/cpu-throttling=true` (confirmed: `gcloud run services describe three-ws-api --project aerial-vehicle-466722-p5 --region us-central1 --format="value(spec.template.metadata.annotations)"`). Cloud Run's documented behavior under CPU throttling is to withdraw CPU allocation from an instance once its HTTP response has been sent. That detached handler promise from step 4 is exactly the kind of work this freezes mid-flight: any `markFailed()` write for a row whose TTL check hadn't executed yet when the 503 fired does not get a later chance to run on any predictable schedule.

Put together: on any tick where the batch's live polls eat into the 60s budget (measured as routine against an unhealthy `trellis_selfhost` lane, and this is literally the same failure class `tests/forge-finalize.test.js`'s "sweepRow concurrency" describe block was written against on 2026-10-24, just not fully closed by that fix), most or all of that tick's TTL-reap writes for the oldest rows never land. The ROW_CONCURRENCY fix shipped 2026-10-24 bounds *latency per wave*, not *whether the tick finishes within budget at all*, so it did not fix throughput. The backlog only drains on the rare tick that both wins the race against the 60s timer and reaches the TTL branch for enough rows, which matches the observed ~24-hour average time to reap instead of the designed 45 minutes, and fully explains why a separately-stuck lane (`rerig`) that never even gets selected into a batch never resolves at all.

This is distinct from and not already covered by any open order: `prompts/finish/401` (vitest), `403` (docs freshness), `433` (account_link_codes migration) and `435` (sentiment-pulse LKG) do not touch `forge-finalize.js`, `forge_creations`, or `trellis_selfhost`. `docs/ops/production-log-triage.md`'s "HTTP timeout with no cron context" section documents the 503-on-timeout behavior itself as correct, intentional, and already fixed (2026-10-11); it explicitly says the next step is finding "why that handler's own work... is exceeding its declared maxDuration," which is exactly what this order's investigation above answers and this order's fix closes.

## Task

1. Re-derive the current state before changing anything (the numbers above rot fast):
   - `npm run forge:errors -- --days 1`
   - A read-only count of `forge_creations` by status and by the `backend is null and path is null` cluster, using the same `DATABASE_URL` resolution order as `scripts/forge-error-report.mjs` (`.env.local` then `.env` then shell).
   - `node scripts/gcp-logs.mjs -s three-ws-api --since 6h --grep "forge-finalize"` to see whether any `[forge-finalize]` warn lines are currently firing (row-sweep throws, redispatch failures) that would change the diagnosis.
   - Confirm the Cloud Scheduler job is still enabled and firing: `gcloud scheduler jobs describe cron--api-cron-forge-finalize --project aerial-vehicle-466722-p5 --location us-central1 --format="yaml(state,schedule,lastAttemptTime)"`.
   If the backlog has already drained below, say, 50 generating rows older than an hour, re-measure twice more a few minutes apart before concluding the bug fixed itself; if it is confirmed gone, stop and report that instead of forcing a fix onto a non-reproducing bug.
2. Read `api/cron/forge-finalize.js` in full (589 lines), focused on: the `BATCH_LIMIT`/`GRACE_MINUTES`/`HARD_TTL_MINUTES` constants (lines ~64-79), the sweep query and its `wrapCron` wiring (the `export default wrapCron(...)` block), and the full body of `sweepRow` (the exported function), to confirm the call ordering: live poll attempted first, TTL reap only reached afterward.
3. Add a cheap, poll-free reap pass that runs **before** any network call and is not subject to `BATCH_LIMIT`:
   - In the handler, before building the existing `rows` query, run a single DB-only sweep: `update forge_creations set status = 'failed', error = 'generation timed out after ' || round(extract(epoch from (now() - created_at)) / 60) || ' minutes', updated_at = now() where status = 'generating' and replicate_job_id is not null and created_at < now() - (${HARD_TTL_MINUTES} * interval '1 minute') returning id, user_id, prompt, backend, tier, path`. Match whatever column `markFailed` (used elsewhere in this file, grep for its import) actually writes to (`error` vs `error_message`, `updated_at` handling) rather than inventing a different shape; reuse `markFailed` itself in a loop over the returned ids if that keeps the write path identical to the rest of the file, as long as it still runs with no live-poll call in between.
   - For nvidia-backend rows caught by this pass, keep the existing `markProviderCooldown(NIM_TRELLIS_COOLDOWN_KEY, ...)` side effect from the current bottom-of-`sweepRow` TTL branch so that behavior is not lost.
   - Fire `notifyForgeFailed` for any row with a `user_id`, matching the existing notification call in the current TTL branch.
   - This pass has no `BATCH_LIMIT`: let it reap everything past the hard TTL in one query (a plain `UPDATE ... WHERE ... RETURNING` is cheap even over hundreds of rows; it does not touch any upstream network service, so it cannot inherit `trellis_selfhost`'s latency).
   - Only after this pass completes, run the existing `rows` query and the existing `mapPoolSettled(rows, ROW_CONCURRENCY, sweepRow)` live-poll path, exactly as today, for whatever is left in `generating` that is still inside the TTL window (so freshly-finishing jobs are still detected promptly without waiting for the hard TTL).
4. Update `sweepRow` so its own bottom-of-function TTL branch (`if (ageMinutes > HARD_TTL_MINUTES) { ... }`) becomes unreachable dead code only if the new pass makes it provably so, or simplify/remove it if the new upfront pass supersedes it entirely; do not leave two different code paths doing the same reap with diverging behavior (duplicate the cooldown/notify side effects correctly, then delete the old branch, rather than keeping both).
5. Write the failing test first, in `tests/forge-finalize.test.js`:
   - A new `describe` block (e.g. `'TTL reap runs ahead of the live poll'`) with a case that builds a batch where the oldest rows are all one backend (simulating the `trellis_selfhost` monopoly) and a few rows belong to a different, never-selected backend/path, all already past `HARD_TTL_MINUTES`. Assert that after running the handler's reap logic (call whatever new exported function you factor the reap query into, the same way `sweepRow` is already exported for testing), every row past the TTL ends up `failed` with a "timed out" error, **regardless of batch position**, and without requiring a mocked `gcp.status()`/`nvidia.status()` call to resolve at all (prove the reap path makes zero live-poll calls: a `gcp`/`nvidia` stub whose `status` throws if invoked should still let the test pass).
   - Run it now and confirm it fails against the current, unfixed code (today, the never-selected-backend rows should NOT resolve because they never reach any reap logic without first winning a slot in the oldest-25 batch). This is the required pre-fix failure check from the test-first rule.
   - Keep the three existing "sweepRow concurrency" tests passing unchanged; they test the live-poll path's concurrency, which this order does not remove, only reorders relative to the new upfront reap.
6. Fix the code per tasks 3-4, re-run the new test and confirm it now passes, then run the full file: `npx vitest run tests/forge-finalize.test.js`.
7. Run `npm run check:rules -- --paths api/cron/forge-finalize.js tests/forge-finalize.test.js` and fix anything it flags.
8. Read the full diff (`git diff api/cron/forge-finalize.js tests/forge-finalize.test.js`) and confirm every changed line traces to a task above.
9. This fix cannot be verified against production from this session (no deploy in an evolve lane), so the report must say plainly that the backlog drain itself is unverified live and will only be confirmed once this ships; do not claim the production backlog is fixed.

## Done when

- A new test in `tests/forge-finalize.test.js` proves rows past `HARD_TTL_MINUTES` get reaped to `failed` without needing to win a slot in the oldest-N batch and without making any live-poll call, confirmed to fail against the pre-fix code first.
- `api/cron/forge-finalize.js` runs a poll-free, `BATCH_LIMIT`-free reap pass over every `generating` row already past `HARD_TTL_MINUTES` before it runs the existing live-poll batch, so a slow or unhealthy backend's rows can no longer block a different backend's or lane's rows from ever being reaped.
- The existing nvidia-cooldown and `notifyForgeFailed` side effects on hard-TTL reap are preserved (moved into the new pass, not dropped).
- No duplicate/conflicting reap logic is left behind: the old bottom-of-`sweepRow` TTL branch is either removed or made provably unreachable, not left as a second, diverging path.
- `npx vitest run tests/forge-finalize.test.js` passes in full, including the three pre-existing concurrency tests unchanged.
- `npm run check:rules -- --paths api/cron/forge-finalize.js tests/forge-finalize.test.js` passes.
- `git diff` reviewed; every changed line traces to a task above.
- The fix is committed on `evolve` with explicit paths and a commit message naming the bug and the fix.
- The report states plainly that the live production backlog's actual drain is unverified until this ships (no deploy happens in this lane).
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the fix commit SHA and what was verified (and noting the live backlog drain is pending a deploy, if a deploy still has not happened by then).

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| The exact mechanism by which in-flight writes are lost after a 503 (Cloud Run CPU throttling after response) cannot be proven from inside this session without a live, timed repro against production | The fix does not depend on proving that specific mechanism. Decoupling the TTL reap from the live poll is correct and sufficient regardless of whether the loss is CPU-throttling-after-response, the tick simply never reaching that row's turn, or some other budget-exhaustion effect: a reap pass with no network call and no `BATCH_LIMIT` always finishes well inside 60s no matter which of those is the exact cause | Ship the decoupled reap. Do not spend session time trying to reproduce the exact freeze live against production; the code-level evidence already chains to it (wrapCron's own comment, confirmed `cpu-throttling=true` on the service, and the observed ~24h-vs-45min mismatch) |
| `trellis_selfhost` itself looks unhealthy and fixing *that* (the worker, its GPU queue, `MODEL_TRELLIS_URL`) feels like the "real" fix | `model-trellis`'s own `/health` reports fully healthy (`ready: true`, `pipeline_loaded: true`, `load_error: null`) as of this order's measurement, and `model-rig` (a completely different worker, same symptom) is healthy too. The problem is the cron's reap path, not any one worker | Do not touch the worker services. Fix `api/cron/forge-finalize.js` only |
| Rewriting the reap as a bulk UPDATE changes the error message format other code might parse (e.g. `forge-error-report.mjs`'s failure-class matching on `error ilike '%timed out%'`) | The task instructs reusing the exact same "generation timed out after N minutes" message shape the current code already writes, so no downstream matcher changes | Keep the message text and any column names identical to what `markFailed`/the current TTL branch already write; do not invent a new error string |
| This looks like it needs a production deploy to actually fix anything, which is owner-gated | Shipping the code fix, tests, and commit is this order's entire scope. The evolve lane never deploys; deploying this is the one step the owner (or a deploy-authorized session) takes afterward | Finish and commit the code fix. State in the report that the live backlog will not visibly drain until a deploy ships this |

## Report format

State: the measured re-derivation from task 1, the failing test's first (red) run output, the fix, the passing test run output (full file), the `check:rules` result, the diff, and the commit SHA. End with one explicit line: "Production backlog drain: unverified, pending deploy."
