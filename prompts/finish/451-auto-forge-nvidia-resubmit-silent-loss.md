# 451. Find out why nvidia-lane forge resubmits never fire (or never prove they fired) and make the attempt durable

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix: follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Task 2 below IS the required failing/diagnostic test; its result tells you which of the two fixes in task 3 applies. Write it, run it, read what it proves, then fix the code, then confirm the fix with a second assertion. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-25)

`npm run forge:errors -- --days 1` on production data:

    generations 735   done 0   failed 26   still running 709
    success rate 0.0%
    rank 1: lost_task, 75.0% of failures, worst lane nvidia x10, message "NVCF request not found or expired"

A direct read-only query (same `DATABASE_URL` resolution `scripts/forge-error-report.mjs` uses) over the last 2 days:

    select id, preview_image_url is not null as has_image, path, prompt is not null as has_prompt
    from forge_creations
    where status = 'failed' and backend = 'nvidia' and error ilike '%not found or expired%'
      and updated_at > now() - interval '2 day';
    -- 15 rows, every one: has_image=false, path='image', has_prompt=true

Every one of these rows is a text-prompt nvidia request (no reference image: `preview_image_url` is null on all 15, confirming the code comment at `api/cron/forge-finalize.js` line ~160 that nvidia rows never carry one, so cross-lane redispatch via `tryCronRedispatch` genuinely has nothing to reconstruct from; that is a deliberate, correct design, not the bug). The ONLY recovery path the code has for this shape is the same-lane resubmit in `sweepRow`'s `row.backend === 'nvidia' && nvidia` branch (`api/cron/forge-finalize.js`, read the current line numbers with `grep -n "row.backend === 'nvidia'" api/cron/forge-finalize.js`, approx lines 441-560 as of this writing):

- Lines ~471-510: if the poll is still `running`/`queued`, `decideNvidiaStall` may trigger one same-lane resubmit via `nvidia.textTo3d(...)`, logging `[forge-finalize] NVCF request stalled; resubmitted...` on success or `[forge-finalize] NVCF stall resubmit failed: ...` on throw.
- Lines ~511-548: if the poll comes back `code: 'nvcf_expired'` (the 404 case, `api/_providers/nvidia.js` line ~447) **and `row.prompt` is truthy**, the same resubmit is attempted, logging `[forge-finalize] NVCF request expired; resubmitted...` on success or `[forge-finalize] NVCF resubmit failed: ...` on throw.
- Line ~549: `else if (status?.status === 'failed')` is the only other place a 'failed' status lands; it calls `markFailed` with the raw `status.error` and logs nothing.

All 15 measured rows have `prompt` set, so on a clean read of the code they should enter the lines ~511-548 branch, not fall through to line 549. Yet a full-text search of every log line this file ever emits finds zero matches, ever:

    node scripts/gcp-logs.mjs -s three-ws-api --all --grep "forge-finalize\]" --since 7d
    # "No matching entries for all services in the last 7d."

That is not "the resubmit branch is broken," that is "every one of this file's dozen or so `console.warn('[forge-finalize] ...')` calls, across every branch (success, failure, redispatch, row-sweep-threw), has never once appeared in Cloud Logging in 7 days," despite the cron running every minute (confirmed live: `node scripts/gcp-logs.mjs -s three-ws-api --all --grep "forge-finalize" --since 48h` shows a 200 roughly once a minute, each run taking 25-47s, with one `503` timeout observed at 2026-10-25T07:08:03Z) and despite rows demonstrably reaching terminal `failed`/`done` states in the database every day. Two explanations are consistent with the evidence, and this order's first task is to find out which:

- **(A) Pure observability bug**: the resubmit logic runs correctly, but every `console.warn` call in this specific cron handler is lost before Cloud Logging's sink flushes it, most likely the same mechanism `prompts/finish/436-auto-forge-finalize-ttl-reap-decoupling.md` already proved for this file's write path: Cloud Run's `cpu-throttling=true` setting withdraws CPU the instant the HTTP response is sent, and `wrapCron`'s budget race (`api/_lib/http.js`) answers the request without cancelling the in-flight handler, so any stdout write queued after that point can be dropped. If true, the resubmits may actually be succeeding (or failing) silently, and the real defect is that nobody can tell, and a resubmit attempt that gets cut off mid-flight after calling `nvidia.textTo3d()` but before `cacheSet`-ing the new alias leaves that row with no record that an attempt was even made, so the operator (and the next tick) cannot distinguish "never tried" from "tried and lost the result."
- **(B) An actual logic gap**: something about the real data (a value this order's queries have not captured) routes these 15 rows to line ~549 instead of line ~511 despite `prompt` being set now. This order's task 2 proves or disproves this directly.

This is not covered by order 436 (436 is scoped to the TTL-reap pass ahead of the live poll for the self-host/gcp lane; it does not touch the nvidia branch's resubmit-on-expiry logic at all) or by any other open order (checked every filename in `prompts/finish/` against `forge-finalize.js`, `forge_creations`, and `nvcf`; none match this branch).

## Task

1. Re-derive before changing anything (numbers rot fast):
   - `npm run forge:errors -- --days 1` and compare the `lost_task` share and worst lane to the numbers above.
   - The two queries above (failure count by class, and the `has_image`/`path`/`has_prompt` breakdown for the `nvidia` + `not found or expired` rows in the last 2 days).
   - `node scripts/gcp-logs.mjs -s three-ws-api --all --grep "forge-finalize\]" --since 7d` to confirm the log silence still holds.
   - If `forge:errors` no longer shows `lost_task` as the top class on the `nvidia` lane, or the log grep now returns matches, re-measure once more before concluding the finding has changed; if genuinely resolved, stop and report that instead of forcing a fix.

2. Write the diagnostic test first, in `tests/forge-finalize.test.js`, in a new `describe('nvidia resubmit on expiry')` block:
   - Build a row shaped like the 15 measured ones: `backend: 'nvidia'`, `prompt: 'a test prompt'`, `preview_image_url: null`, `path: 'image'`, `replicate_job_id` a plain UUID-shaped string (not a packed envelope, not an `f1.` token), `created_at` recent (well inside `ATTENDED_POLL_BUDGET_MINUTES`, so the stall branch at lines ~471-510 is not what triggers).
   - Stub `nvidia = { status: async () => ({ status: 'failed', code: 'nvcf_expired', error: 'NVCF request not found or expired' }), textTo3d: async ({ prompt }) => ({ taskId: 'resubmit-task-id' }) }`.
   - Call `await sweepRow(row, { gcp: null, nvidia })` directly (same pattern the existing "sweepRow concurrency" describe block already uses; no mocking of `cache.js`/`forge-store.js` needed, both degrade to an in-memory fallback without Redis/DB configured in the test environment, confirmed by reading `api/_lib/cache.js` lines ~505-513 and ~381-391).
   - Assert `out.resubmitted === 1` and `out.failed === 0` and `out.done === 0`.
   - Run it now: `npx vitest run tests/forge-finalize.test.js -t "nvidia resubmit on expiry"`.
   - **Read the result honestly and follow whichever branch below actually happened; do not assume which one in advance.**

3. Branch on what task 2 proved:
   - **If the test passes as written** (the code correctly resubmits in isolation): this confirms hypothesis (A), a pure code-logic reading was not the bug, the gap is durability under truncation. Fix it by making the resubmit attempt durable-before-network: immediately after `acquireLock('nvcf:resub:...')` succeeds (line ~517) and again in the stall branch after its own lock (line ~483), `cacheSet` a short-TTL "attempt in progress" marker (e.g. `nvcf:resub-inflight:${row.replicate_job_id}`, TTL a few minutes, well under `NVCF_ALIAS_TTL_S`) **before** calling `nvidia.textTo3d(...)`, so a truncated tick leaves evidence instead of silence. Read that marker at the top of the branch (alongside the existing `alreadyResubmitted` check fed into `decideNvidiaStall`) and, if an in-progress marker is already set and still fresh, defer rather than re-attempt (avoids firing a second paid NVCF submission for the same row if the first attempt is merely slow, not lost). Also switch the two outcome logs (`[forge-finalize] NVCF request expired; resubmitted...` and `[forge-finalize] NVCF resubmit failed: ...`) from `console.warn` to whatever this codebase's durable ops-alert path is for cron-observed failures worth not losing (`grep -rn "sendOpsAlert" api/_lib/ | grep -v test` to find it and confirm its signature before using it; if its severity levels would make a routine, self-recovering resubmit too noisy, keep `console.warn` for the success case and route only the `catch` failure case through it, matching how `x402-ring-leak-scan.js` already escalates CRITICAL-only events through the same helper).
   - **If the test fails** (resubmitted stayed 0, failed became 1, or it threw): the code-reading above missed something. Add `console.log` tracing temporarily inside the branch to see exactly which condition evaluates false for this exact row shape, find the real condition, then fix that condition (not the durability mechanism from the branch above) so the test passes for the right reason. Remove the temporary tracing before committing.
   - Whichever branch applies, add the second assertion the fix implies (either durability under a simulated truncation, or the corrected condition) to the same `describe` block, and keep the task-2 test passing unchanged alongside it.

4. Run the full file: `npx vitest run tests/forge-finalize.test.js` and confirm every test passes, including the three pre-existing "sweepRow concurrency" tests unchanged.

5. Run `npm run check:rules -- --paths api/cron/forge-finalize.js tests/forge-finalize.test.js` and fix anything it flags.

6. Read the full diff (`git diff api/cron/forge-finalize.js tests/forge-finalize.test.js`) and confirm every changed line traces to task 3.

7. This fix cannot be verified against the live 24h-failure-rate from this session (no deploy in an evolve lane). The report must say plainly that the production `lost_task` share will only visibly drop once this ships; do not claim the live number is already fixed.

## Done when

- `tests/forge-finalize.test.js` has a new `describe('nvidia resubmit on expiry')` block whose first test is the task-2 diagnostic, run and read honestly before any code change.
- The code fix matches whichever branch task 2 actually proved (durability-before-network-call, or a corrected condition), not a guess made in advance of running the test.
- `npx vitest run tests/forge-finalize.test.js` passes in full, including the three pre-existing concurrency tests unchanged.
- `npm run check:rules -- --paths api/cron/forge-finalize.js tests/forge-finalize.test.js` passes.
- `git diff` reviewed; every changed line traces to the task list above.
- The fix is committed on `evolve` with explicit paths and a commit message naming the bug and which of the two branches (A or B) task 2 proved.
- The report states plainly that the live `lost_task` rate is unverified until this ships (no deploy happens in this lane).
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the fix commit SHA, which branch (A or B) the diagnostic test proved, and that the live backlog drain is pending a deploy.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| The exact reason `console.warn` output never reaches Cloud Logging for this file cannot be proven with certainty from inside this session (no way to attach a debugger to a live Cloud Run instance mid-truncation) | The fix in branch (A) above does not depend on proving the exact flush mechanism. Making the resubmit attempt durable-before-network-call, and routing the one log that matters (a failed resubmit) through an existing durable alert path instead of a bare `console.warn`, is correct and sufficient regardless of whether the specific loss mechanism is CPU-throttling-after-response, a stdout buffering race, or something else | Ship the durable-attempt fix per branch (A). Do not spend session time trying to reproduce the exact log-loss mechanism live against production |
| This looks like the same bug as order 436 (both are forge-finalize, both are about work getting lost near the cron's time budget) | 436 is scoped to the TTL-reap pass for the self-host/gcp lane (`envelope && gcp` branch, lines ~335-407); this order is scoped to the nvidia same-lane resubmit logic (`row.backend === 'nvidia'` branch, lines ~441-560), a different branch with a different recovery mechanism (same-lane resubmit, not cross-lane redispatch) | Fix only the nvidia branch here. If 436 is still open when this runs, expect its diff to touch the same file in a different region; re-check `git diff` line ranges do not overlap before committing, and re-run the full test file either way |
| Giving nvidia rows a cross-lane `tryCronRedispatch` fallback (matching the gcp branch) seems like the obvious parity fix | It is not available for these rows: `tryCronRedispatch`/`pickRedispatchLane`/`submitFailoverJob` all reconstruct from a stored reference image (`decideFailedSweep`'s `hasReferenceImage` gate), and every one of the 15 measured nvidia rows has `preview_image_url = null`. There is nothing to redispatch with; NVIDIA NIM is the only text-to-3D lane on this platform (confirmed by the code's own comment at `decideNvidiaStall`, lines ~160-163) | Do not add a cross-lane redispatch call to the nvidia branch. The fix is making the existing same-lane resubmit durable, not adding a lane that cannot serve a text-only request |
| This looks like it needs a production deploy to actually prove anything fixed, which is owner-gated | Shipping the code fix, tests, and commit is this order's entire scope. The evolve lane never deploys; deploying this is the one step the owner (or a deploy-authorized session) takes afterward | Finish and commit the code fix. State in the report that the live `lost_task` rate will not visibly drop until a deploy ships this |

## Report format

State: the measured re-derivation from task 1, which branch (A or B) the task-2 diagnostic test proved and its exact pass/fail output, the fix, the passing test run output (full file), the `check:rules` result, the diff, and the commit SHA. End with one explicit line: "Live lost_task rate: unverified, pending deploy."
