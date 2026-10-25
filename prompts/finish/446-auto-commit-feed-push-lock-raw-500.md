# 446. `commit-feed-push` cron still raw-500s roughly 1 in 8 ticks because `acquireLock()` sits outside its own error guard

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix: follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Write the failing test first, confirm it fails for the stated reason, then fix the code, then confirm it passes. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-25)

`tests/commit-feed-push-handler.test.js` already documents and fixes ONE raw-500 cause on this route (`pushTelegramLane()` throwing a non-rate-limit error, fixed 2026-10-24: the handler's try/catch around `pushTelegramLane()` now answers a graceful `502 { ok:false, error }` instead). That fix is shipped and this order does not touch it or duplicate it.

A second, still-open cause lives one line above that try block. Read today's `api/cron/commit-feed-push.js`:

    export default wrapCron(async (req, res) => {
      if (!method(req, res, ['GET'])) return;
      if (!requireCron(req, res)) return;

      if (!(await acquireLock())) {               // <- OUTSIDE the try/catch below
        json(res, 200, { ok: true, skipped: 'locked' });
        return;
      }

      try {
        const telegram = await pushTelegramLane();
        ...
      } catch (err) {
        ...
        json(res, 502, { ok: false, error: String(err?.message || err) });
      } finally {
        await releaseLock().catch(() => {});
      }
    });

`acquireLock()` (`api/_lib/commit-feed-push.js`) makes two raw, unguarded `sql` calls (`ensureTable()` then an `INSERT ... ON CONFLICT` UPSERT against `app_settings`) with no internal try/catch. A transient Neon connection fault here (anything that is not a full DB-down/at-capacity condition, which `wrapCron`'s own catch already special-cases via `isDbUnavailableError`/`isDbCapacityError`, e.g. a one-off pooled-connection reset) throws straight past the `acquireLock()` call site, is never seen by the handler's try/catch (it starts on the next line), is re-thrown unchanged by `wrapCron`'s `runHandler` catch (`if (isDbUnavailableError(err) || isDbCapacityError(err)) { ...; return; } throw err;`), and lands in `wrap()`'s generic `else` branch: `console.error('[api] unhandled ...')`, `captureException(err, ...)` (Sentry), `sendOpsAlert('unhandled 5xx in ...', ...)`.

Live confirmation, 24h production error logs (`gcloud logging read` against `resource.type=cloud_run_revision AND resource.labels.service_name=three-ws-api AND httpRequest.status=500`, project `aerial-vehicle-466722-p5`, region `us-central1`, service `three-ws-api`):

    /api/cron/commit-feed-push : 34 occurrences of HTTP 500 in the trailing 24h window (today's date 2026-10-25)

This cron runs every 5 minutes (per its own header comment), so 24h is ~288 ticks; 34/288 is roughly one in eight ticks. A tighter sample (the most recent 6h) showed the failures spread across the window rather than one contiguous incident, and the most recent ~15 ticks before that sample all answered 200: an intermittent, self-healing, still-live pattern, not a one-time blip already resolved. This is consistent with a transient connection-pool fault on the raw `acquireLock()` UPSERT, not a sustained DB outage (which `isDbUnavailableError` already catches and which would instead show as the existing graceful 200 `db_unavailable` skip, confirmed absent from these 34 rows by their status code of 500, not 200).

This is a live production defect causing real Sentry noise and ops alerts roughly 34 times a day, with a confirmed, narrow, root-caused fix: the same lock-skip semantics the handler already uses for "lock busy" (`{ok:true, skipped:'locked'}`, 200) are the correct answer for "could not even check the lock due to a transient fault" too, since both cases mean "do nothing this tick, the state in `app_settings` is untouched, let the next tick (5 minutes away) retry."

## Task

1. Read `api/cron/commit-feed-push.js` in full (45 lines).
2. Read `api/_lib/commit-feed-push.js`'s `acquireLock`, `releaseLock`, `ensureTable`, `getState`, `setState` functions (the raw `sql` call sites, no internal try/catch anywhere in this group).
3. Read `tests/commit-feed-push-handler.test.js` in full: the file to extend, including its `vi.mock('../api/_lib/commit-feed-push.js', ...)` setup (`acquireLock: vi.fn(async () => !lock.held)`) and its `makeReqRes()` helper.
4. Write the failing test first, in `tests/commit-feed-push-handler.test.js`: a new case where the mocked `acquireLock` rejects (`acquireLock: vi.fn(async () => { if (lockThrows.value) throw lockThrows.value; return !lock.held; })`, with a module-level `lockThrows` object the test sets before calling the handler, mirroring the existing `pushResult` pattern). Assert that when `acquireLock` rejects with `new Error('Connection terminated unexpectedly')`:
   - `res.statusCode` is NOT `500`.
   - The response is a graceful skip (`200`, `{ ok: true, skipped: 'lock_error' }` or equivalent, matching the existing `{ok:true, skipped:'locked'}` shape's spirit: pick `skipped: 'lock_error'` so ops can distinguish "lock held" from "lock check failed" in logs/metrics if this cron is ever queried for one).
   - `releaseLock` is NOT called (the lock was never acquired, so there is nothing to release; calling it anyway on an unacquired lock would incorrectly stamp the lock row).
   - `pushTelegramLane` is NOT called (the tick must stop, not proceed to post while the lock state is unknown).
   Run it now (`npx vitest run tests/commit-feed-push-handler.test.js`) and confirm the new case fails against the current code (today it throws past the handler entirely, which in a real `wrapCron` invocation reaches `wrap()`'s generic 500 path; against this test's bare mock it will surface as an unhandled rejection or a thrown error from `handler()` itself, not a clean assertion failure, since nothing catches it today, which IS the bug).
5. Fix `api/cron/commit-feed-push.js`: wrap the `acquireLock()` call in its own try/catch so a thrown error degrades to the same `200 { ok: true, skipped: 'lock_error' }` response the existing `{ok:true, skipped:'locked'}` branch uses, without calling `releaseLock()` (nothing was acquired) and without calling `pushTelegramLane()`. Keep a `console.warn` logging the error message so it is still visible in Cloud Run logs for diagnosis, matching the existing `console.warn` style used elsewhere in this file for the lane-error case.
6. Re-run `npx vitest run tests/commit-feed-push-handler.test.js`: the new case and both pre-existing cases must pass.
7. Run `npx vitest run tests/commit-feed-push.test.js` (the lower-level `acquireLock`/`pushTelegramLane` unit tests) to confirm nothing there regressed; this order does not change `api/_lib/commit-feed-push.js` itself, only the handler's call site, so these should be unaffected, but confirm rather than assume.
8. Run `npm run check:rules -- --paths api/cron/commit-feed-push.js tests/commit-feed-push-handler.test.js` and fix anything it flags.
9. Add a `data/changelog.json` entry (tag `fix`, internal/ops-facing change, no specific user page link needed) describing that the commit-feed cron now skips gracefully instead of alerting on a transient lock-check fault, then run `npm run build:pages` and confirm only the expected generated files change.
10. Read the full diff (`git diff api/cron/commit-feed-push.js tests/commit-feed-push-handler.test.js data/changelog.json`) and confirm every changed line is one of the changes above.

## Done when

- `tests/commit-feed-push-handler.test.js` has a new case covering `acquireLock()` throwing, confirmed to have failed against the pre-fix code before the fix landed.
- `api/cron/commit-feed-push.js` catches an `acquireLock()` rejection and answers `200 { ok: true, skipped: 'lock_error' }` without calling `releaseLock()` or `pushTelegramLane()`.
- `npx vitest run tests/commit-feed-push-handler.test.js` passes in full (all cases, old and new).
- `npx vitest run tests/commit-feed-push.test.js` still passes unchanged.
- `npm run check:rules -- --paths api/cron/commit-feed-push.js tests/commit-feed-push-handler.test.js` reports no violations.
- A changelog entry exists and `npm run build:pages` ran cleanly.
- Nothing outside `api/cron/commit-feed-push.js`, `tests/commit-feed-push-handler.test.js`, `data/changelog.json`, and the generated `public/changelog*`/`CHANGELOG.md` files changed. In particular, `api/_lib/commit-feed-push.js` itself (the `acquireLock` implementation) is NOT touched: this order only guards the existing call site, it does not change what `acquireLock` does.

## Never blocked

| Apparent blocker | Resolution |
| --- | --- |
| "Should I also make `acquireLock()` itself retry or add its own internal try/catch?" | No. Guarding the call site is the narrower, sufficient fix and matches how `wrapCron`'s own DB-outage branch already treats a failure one level up, not inside the DB helper. Do not change `api/_lib/commit-feed-push.js`. |
| "Is `skipped: 'lock_error'` the right string, or should I ask?" | No, pick it and move on; it only needs to be distinct from the existing `'locked'` value and self-describing in a log line. No consumer parses this field today (confirm with `grep -rn "skipped.*locked\|skipped.*lock_error" --include=*.js .` outside this cron and its test before assuming otherwise). |
| "The 34-occurrences-a-day rate might have changed by the time I run this; does the order still apply?" | Yes. The fix removes a real, reachable code path (any `acquireLock()` rejection reaching `wrap()`'s generic handler) regardless of today's exact rate; use the synthetic error in the test, not a live occurrence. |

## Report format

State: the test case added (file and name), the vitest pass count before and after for both test files touched, the `check:rules` result, and the commit hash. If the 34/24h figure has visibly changed (e.g. a new `gcloud logging read` shows a different count) between your Step 0 re-measurement and completion, say so in one line; it does not change what to ship.
