# 411. Fix the Base ERC-8004 crawler stall: teach `isRangeRejection()` Base's real error wording

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- Bug fixes are test-first: reproduce with a failing test before touching the fix, confirm it fails for the stated reason, then fix, then confirm green. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Step 0: re-derive the current state

    curl -s https://three.ws/api/healthz | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(JSON.stringify(j.subsystems.subsystems.find(s=>s.name==='agent_index'),null,2))})"

Confirm the `agent_index` subsystem still reads `status: "down"` with Base (chain 8453) named as the worst/stalest EVM chain, something like: `"EVM: ...44h+ worst cursor age (Base) across 22/22 chains, worst backlog 80,000+ blocks (Base)..."`. If Base no longer appears as the outlier (another agent already shipped this fix and it has been deployed and had time to catch up), re-run the query below to confirm `erc8004_crawl_cursor` shows all 22 chains fresh, then retire this order without a code change per the "Never blocked" table.

Confirm the exact production error text (requires the production `DATABASE_URL`, resolved on demand, never written to a file):

    export DATABASE_URL="$(node scripts/read-service-env.mjs '^DATABASE_URL$' | tail -1)"
    node -e "
    import('./api/_lib/db.js').then(async ({ sql }) => {
      const rows = await sql\`SELECT chain_id, last_block, head_block, blocks_behind, updated_at, last_error, chunk_size FROM erc8004_crawl_cursor ORDER BY blocks_behind DESC NULLS LAST LIMIT 5\`;
      console.log(rows);
      process.exit(0);
    });
    "

As measured 2026-10-24: chain_id 8453 (Base) is the only abnormal row of 22, frozen at `updated_at: 2026-10-22T07:46:23.684Z` (then 44+ hours stale and growing every tick since), `blocks_behind: 80529` and climbing, `last_error: "RPC -32602: query exceeds max results 20000, retry with the range 52932450-52933133"`. All 21 other chains show `blocks_behind: 0` and `updated_at` within the last 15 minutes.

Confirm the Cloud Scheduler job itself is running normally (ruling out a scheduling failure, not a classification bug):

    gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" httpRequest.requestUrl:"erc8004-crawl"' --limit=5 --freshness=1h --project aerial-vehicle-466722-p5 --format='value(httpRequest.status, timestamp)'

Expect a dense list of `200` responses roughly every 15 minutes. The cron runs successfully every tick; the bug is purely in how one chain's error gets classified inside that successful run.

## Root cause

`api/cron/[name].js` defines `RANGE_REJECTED` (a regex of every wording a provider uses when it refuses a block range that is too wide) and `isRangeRejection(message)`, which tests a thrown RPC error's message against it. When `isRangeRejection()` returns true, `erc8004CrawlChain()` shrinks `chunkSize` via `backoffChunkSize()` and retries the same range at a narrower window, which is how the crawler self-heals against a provider's range ceiling. When it returns false, the error is treated as a genuine, unrecoverable fault: `erc8004RecordBacklog()` runs (updates `head_block`/`blocks_behind` only) and the error is rethrown up to the per-chain `catch` in `handleErc8004Crawl()`, which writes only `last_error` to the row, never `updated_at`, `last_block`, or `chunk_size`. The row then never adjusts again.

Base's real RPC answer, `"RPC -32602: query exceeds max results 20000, retry with the range 52932450-52933133"`, does not match any alternative in `RANGE_REJECTED` (`block range|range is too large|too wide|too many blocks|ranges? over \d+ blocks|query returned more than|exceed maximum block range|limited to|response size|logs matched`, case-insensitive). "query exceeds max results" and "retry with the range" are both absent from the pattern, so `isRangeRejection()` wrongly returns `false` for a message that is, semantically and literally, a range-too-wide rejection (the provider even names the exact smaller range it would accept). The adaptive shrink-and-retry path never engages for Base, so its cursor has been frozen since 2026-10-22T07:46:23.684Z.

## Task

1. Open `tests/agent-index.test.js` and find the `describe('isRangeRejection', ...)` block (around line 477). Add a new test case reproducing Base's exact verbatim error, asserting `isRangeRejection(...)` returns `true`:

   ```js
   it('reads Coinbase/Base RPC wording ("exceeds max results ... retry with the range") as a range ceiling', () => {
     // Verbatim from erc8004_crawl_cursor.last_error on chain 8453 (Base), frozen since 2026-10-22.
     expect(
       isRangeRejection('RPC -32602: query exceeds max results 20000, retry with the range 52932450-52933133'),
     ).toBe(true);
   });
   ```

2. Run `npx vitest run tests/agent-index.test.js` and confirm this new case fails (the existing `isRangeRejection` returns `false`). Confirm the failure is this exact assertion, not an unrelated error.
3. Open `api/cron/[name].js`, find the `RANGE_REJECTED` regex (around line 465, right above `isRangeRejection`). Add an alternative that matches this wording without weakening the existing negative cases the same test file already pins (`limit exceeded`, `cu limit exceeded...`, `chain is not available on free plan...` must stay `false`). A precise, narrow addition such as `exceeds? max(?:imum)? results|retry with the range` is both specific enough to avoid false-positiving the negative cases and literal enough to match real provider wording (test it against each existing case in the file, not just the new one).
4. Re-run `npx vitest run tests/agent-index.test.js` and confirm every case in the file passes, the new one included.
5. Run the full suite for this module's neighbors to catch any regression: `npx vitest run tests/agent-index.test.js tests/erc8004-chains.test.js` (second file only if it exists; check with `ls tests/ | grep erc8004` first and skip gracefully if it does not).
6. Read `api/cron/[name].js`'s `erc8004CrawlChain()` body once more (around lines 535-660) to confirm that once `isRangeRejection()` returns `true` for this message, the existing `backoffChunkSize()`/retry loop is sufficient on its own to converge Base to a servable window; no other code path needs changing. (It is: the loop shrinks `chunkSize` and retries the same `fromBlock` until a range succeeds or the floor `ERC8004_MIN_BLOCK_CHUNK=100` is hit, both comfortably under the ~683-block range Base's own error message suggested.)
7. Run `npm run check:rules -- --paths api/cron/\[name\].js tests/agent-index.test.js` and fix anything it flags.

## Done when

- `npx vitest run tests/agent-index.test.js` passes in full, including the new Base-wording case.
- `git diff` shows only the `RANGE_REJECTED` regex addition in `api/cron/[name].js` and the new test case (plus whatever `check:rules` required) in `tests/agent-index.test.js`.
- The fix and its test are committed together on `evolve` with an explicit-path commit.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` (create it with a one-line header if it does not exist) citing the fix commit SHA, and a note that Base's actual catch-up (the 80,000+ block backlog draining to `blocks_behind: 0`) happens automatically over the following hours once the fixed code deploys and is not something this session can force; row 1 of `prompts/finish/_context/production-100-OWNER-ACTIONS.md` already tracks the deploy cadence that carries it to production, so do not add a new row for the deploy itself.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Another agent already shipped this fix | Routine for a shared worktree | Re-run step 0's healthz/DB query first; if Base is no longer the outlier and the regex already contains an equivalent alternative, retire this order without a code change |
| Tempted to widen the regex broadly (e.g. bare `exceeds`) to be safe | Over-broad matching risks reclassifying a genuine fault as a shrinkable range, which is exactly the bnbchain `limit exceeded` false positive the existing test file already guards against | Keep the new alternative as narrow as the task describes; run every existing case in the test file against it before committing, not just the new one |
| Can't reach production DB to confirm the live error text | `scripts/read-service-env.mjs` resolves it without needing the credential written anywhere | Use the exact command in step 0; never pipe its output into a committed file |
| Base's backlog has not visibly shrunk yet right after the fix lands | Catching up 80,000+ blocks at an adaptively-sized chunk takes real wall-clock time across many 15-minute ticks | This is expected; the done-when criteria do not require the backlog to be zero by the end of this session, only that the classification bug is fixed and tested |

## Report format

State: the step-0 healthz and DB query output, the failing-test confirmation before the fix, the final regex diff, the passing-test output after the fix, and the commit SHA.
