# 441. Base's EVM agent-index crawl has been frozen for 3+ days: the shrink-retry loop has no time bound

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix: follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Write the failing test first, confirm it fails for the stated reason, then fix the code, then confirm it passes. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.
- Do not run `npm run db:migrate` or any write against production beyond what task 1's read-only query performs. This order ships code; it does not touch the database directly.

## Why this matters (measured 2026-10-25)

Direct production query (read-only, against the live Neon database `api/_lib/db.js` resolves to):

    node --env-file=.env.local -e "import('./api/_lib/db.js').then(async ({sql}) => { console.log(await sql\`SELECT chain_id, last_block, updated_at, head_block, blocks_behind, chunk_size, last_error, now() - updated_at AS stale_for FROM erc8004_crawl_cursor WHERE chain_id = 8453\`); process.exit(0); });"

returns, as of 2026-10-25:

    chain_id: 8453 (Base)
    last_block: 52932449
    updated_at: 2026-10-22T07:46:23.684Z    (stale 2 days 21 hours 19 minutes and counting)
    head_block: 53057528
    blocks_behind: 125079
    chunk_size: 8000
    last_error: "RPC -32602: query exceeds max results 20000, retry with the range 52932450-52933133"

Every other configured chain (checked: 1284, 42161, 421614, 1, and the rest of the 22 in `api/_lib/erc8004-chains.js`) has `updated_at` within the last 15 minutes and `blocks_behind: 0`. `/api/healthz`'s `agent_index` subsystem reports this same frozen state live right now (`worst cursor age (Base) across 22/22 chains, worst backlog 125,079 blocks (Base), 1 behind, 1 stale`), which also drives order 440's severity bug above.

**What is confirmed, by reading the code and the stored row, not by guessing:**

1. `isRangeRejection()` (`api/cron/[name].js:488`) correctly matches Base's exact stored error (confirmed by the existing test `tests/agent-index.test.js:510-515`, "reads Coinbase/Base RPC wording... as a range ceiling", which is verbatim this error). Misclassification is ruled out.
2. `chunk_size` is still `8000`, the configured maximum (`ERC8004_MAX_BLOCK_CHUNK`, line 465), not reduced at all. If the shrink-retry loop in `erc8004CrawlChain` (line 555, the `for (;;)` at line 592) had run even once to completion, `backoffChunkSize(8000)` (line 547) would have halved it to 4000 and either succeeded or shrunk further; if it reached the floor (`ERC8004_MIN_BLOCK_CHUNK = 100`, line 466) and was still rejected, the existing floor-write branch (lines 649-659) would have persisted `chunk_size: 100` and a `'range rejected at 100 blocks (floor)'` message. Neither happened. The row is untouched since 2026-10-22, meaning `erc8004CrawlChain(chain)` for Base has not completed even once since then, successfully or via its own designed failure path.
3. Base is always first in the crawl order every tick (`erc8004CrawlOrder()`/`rank()`, worst-backlog-first, line 407-455; Base has by far the largest `blocks_behind`), so it is not being starved by the per-chain budget check at line 292 (`if (Date.now() - crawlStart > CRAWL_BUDGET_MS) continue`), which only skips chains, not mid-call. Base gets the full tick's budget every time.
4. The generic per-chain catch in `handleErc8004Crawl` (lines 296-306) only writes `last_error` on a thrown exception, with no `updated_at = now()` in that UPDATE. If `erc8004CrawlChain` were throwing on every tick (rather than running forever), this catch would overwrite `last_error` with the identical text each time (since the input is deterministic) while leaving `updated_at`, `last_block`, `chunk_size`, and `blocks_behind` untouched, which is **exactly the frozen shape observed**.
5. `erc8004RpcCall` (line 1041) retries the SAME request against every URL in `chain.rpcUrls` (Base has 4: `mainnet.base.org`, `base.drpc.org`, `1rpc.io/base`, `base-rpc.publicnode.com`, `api/_lib/erc8004-chains.js`) on ANY error, including a well-formed JSON-RPC business error read from the response body (line 1067: `if (data?.error) throw new Error(...)`, caught at line 1071 and retried on the next lane regardless of whether the error is lane-specific). A "query exceeds max results" rejection is a property of the query and the chain's log density in that block range, not of which lane answered it: all 4 lanes will very likely reject it identically, so every rejected `eth_getLogs` call costs up to `4 × ERC8004_FETCH_TIMEOUT_MS` (`4 × 10s = 40s`, line 252/1054) in the worst case, before the caller even learns the range was rejected.
6. Point 5 compounds inside the shrink loop: each iteration of the `for (;;)` at line 592 makes TWO such calls (registry logs at line 603, reputation logs at line 612), and nothing in that loop checks elapsed wall-clock time or caps the number of iterations by time, only by the `backoffChunkSize` fixed point (proven to converge in `tests/agent-index.test.js:416-427`, "reaches a fixed point at the floor"). Every OTHER retry loop in this file has an explicit budget check before continuing (`handleErc8004Crawl`'s per-chain loop, line 292; `erc8004CatchUp`'s round loop, line 375). This one does not.

**The structural bug, independent of exactly how slow any one lane is:** combine points 5 and 6. If even one or two of Base's four lanes are slow or rate-limited enough to burn close to their 10-second timeout on each call (plausible for free public RPC endpoints under sustained load), a few shrink iterations (two calls each, up to four lane-attempts each) can cost minutes of wall-clock time inside a single `erc8004CrawlChain(chain)` call, with no internal checkpoint and no DB write until the function either succeeds or reaches the floor. If whatever invokes this HTTP cron endpoint (Cloud Scheduler's job timeout, or the Cloud Run request timeout) is shorter than that, the whole invocation is killed mid-loop, and because nothing was written, the next tick starts the entire slow sequence over from scratch with the exact same inputs, forever. This matches 2+ days of a completely unchanged cursor despite Base being first in line on every single tick.

This is distinct from and does not duplicate any open order: a grep of every file in `prompts/finish/` for `erc8004CrawlChain`, `shrink`, or `8453` found no existing order naming this gap. It is also distinct from order 440 (above), which fixes how a stuck EVM chain's severity is scored once it exists; this order fixes why the chain gets stuck in the first place.

## Task

1. Re-derive current state before changing anything: re-run the query in "Why this matters" against `erc8004_crawl_cursor WHERE chain_id = 8453` and confirm it is still frozen (or has since moved, in which case say so plainly in the report and confirm whether some other mechanism, e.g. a manual intervention, already resolved it; proceed with the structural fix regardless, since the missing time bound is a real gap independent of today's exact row). Also run `grep -n "Date.now()\|budgetMs\|deadline" api/cron/\[name\].js | sed -n '1,40p'` to confirm the inner loop at line 592 is still the one retry loop in this file with no time-bound check.
2. Add `export` to `erc8004CrawlChain` (line 555, `async function erc8004CrawlChain(chain)` to `export async function erc8004CrawlChain(chain, { now = Date.now } = {})`), mirroring the injectable-clock pattern already used by `drainWithBudget` in `api/_lib/ops/index-lag.js` (tested via the `clockFrom` helper at `tests/agent-index.test.js:556-559`). Thread `now` through to the new budget check in task 3. Update the two call sites (`handleErc8004Crawl` line 297, `erc8004CatchUp` line 383) to still call it with just `(chain)`, relying on the default.
3. Add a new constant near `ERC8004_MIN_BLOCK_CHUNK` (line 466): `const ERC8004_CHAIN_BUDGET_MS = 60_000;` (one minute: comfortably under `CRAWL_BUDGET_MS` at 240_000 so a single stuck chain can never consume the whole tick, and short enough that whatever external request timeout wraps this cron cannot kill the process before a write happens). Export it if the test needs to reference it directly, otherwise keep it module-local and reference the literal in the test with a comment citing the constant name.
4. Inside the `for (;;)` loop (line 592), after computing `toBlock` and before attempting the RPC calls, add a budget check:

       const loopStart = now();
       // ... existing code below `let narrowedFrom = null; let prunedSkip = null;` (line 590-591)
       for (;;) {
         if (now() - loopStart > ERC8004_CHAIN_BUDGET_MS) {
           // The shrink loop has run long enough that something downstream (a slow
           // or rate-limited lane, a dense block range needing many halvings) is
           // costing more wall-clock time than this chain may safely hold the tick
           // hostage for. Persist whatever progress exists so the NEXT tick resumes
           // from here instead of silently retrying the exact same blocks forever.
           await sql`
             INSERT INTO erc8004_crawl_cursor (chain_id, last_block, updated_at, head_block, blocks_behind, chunk_size, last_error)
             VALUES (${chain.id}, ${Math.max(0, fromBlock - 1)}, now(), ${latestBlock},
                     ${Math.max(0, latestBlock - fromBlock + 1)}, ${chunkSize}, ${'shrink loop exceeded ' + ERC8004_CHAIN_BUDGET_MS + 'ms budget at chunk ' + chunkSize})
             ON CONFLICT (chain_id) DO UPDATE SET
               updated_at    = now(),
               head_block    = excluded.head_block,
               blocks_behind = excluded.blocks_behind,
               chunk_size    = excluded.chunk_size,
               last_error    = excluded.last_error
           `;
           return {
             inserted: 0,
             scanned: 0,
             lastBlock: fromBlock - 1,
             fromBlock,
             blocksBehind: Math.max(0, latestBlock - fromBlock + 1),
             chunkSize,
             loopBudgetExceeded: true,
           };
         }
         toBlock = Math.min(fromBlock + chunkSize - 1, latestBlock);
         // ... existing range/try/catch body unchanged

   Place `loopStart` immediately before the `for (;;) {` line so it is set once per call, not per iteration. Re-use the exact `INSERT ... ON CONFLICT` shape already written for the floor-rejection branch (lines 649-659) rather than inventing a new one, so this writes to the same columns the rest of the function already relies on.
5. Write the failing test first, in `tests/agent-index.test.js`, near the existing `nextChunkSize`/`backoffChunkSize`/`isRangeRejection` tests (after line 516, before "Sweep capacity"). Import `erc8004CrawlChain` from `../api/cron/[name].js` (added to the existing import block at lines 39-46). Mock `global.fetch` to always resolve with the Base-shaped `-32602` JSON-RPC error body for `eth_getLogs` (and a normal `eth_blockNumber` response so the function reaches the shrink loop), and mock `sql` the same way `tests/forge-store-listing-orb-safe.test.js` or similar already do for this codebase (`vi.mock('../api/_lib/db.js', ...)`), capturing every call in an array. Use a hand-cranked clock (modeled on `clockFrom` at line 556-559) that advances past `60_000`ms after a small, fixed number of calls to simulate the loop running long. Assert:
   - Before the fix: the test fails because `erc8004CrawlChain` either throws (if all lanes exhaust and the error is not a range rejection by the time it reaches the real code... re-check this against the ACTUAL behavior you observe when running it) or spins past the clock without ever calling `sql`, whichever is actually true against the current code. State in the report which one it was.
   - After the fix: `erc8004CrawlChain` returns an object with `loopBudgetExceeded: true` once the clock crosses `ERC8004_CHAIN_BUDGET_MS`, and exactly one `sql` call was made (the budget-exceeded INSERT/UPDATE), proving a write happens within the bounded time regardless of how many lanes or shrink iterations are still pending.
   Run `npx vitest run tests/agent-index.test.js -t "shrink loop"` (or whatever test name you give it) now, before the fix, and confirm it fails for the stated reason, not a mocking/setup error.
6. Apply the fix from tasks 2-4, then re-run the same test and confirm it passes.
7. Run `npx vitest run tests/agent-index.test.js` in full and confirm every existing test still passes, especially `nextChunkSize`, `backoffChunkSize`, `isRangeRejection`, `isPrunedHistoryRejection`, `catchUpCandidates`, and `rank` (unaffected by this change, but prove it).
8. Run `npm run check:rules -- --paths "api/cron/[name].js" tests/agent-index.test.js` and fix anything it flags.
9. Read the full diff (`git diff "api/cron/[name].js" tests/agent-index.test.js`) and confirm every changed line traces to a task above. Confirm the two existing call sites of `erc8004CrawlChain` (handleErc8004Crawl line 297, erc8004CatchUp line 383) still compile and behave identically when called with just `(chain)` (relying on the default `now`).
10. This fix cannot be verified against production from this session (no deploy in an evolve lane, and this order does not write to the database directly: the live Base cursor stays frozen until the fix ships and a cron tick runs). The report must say plainly that Base's live cursor is unverified-to-recover until this ships, and must requote the live `erc8004_crawl_cursor` row for chain 8453 from task 1 as the baseline a deploy should change.

## Done when

- `erc8004CrawlChain` accepts an injectable `now` clock (default `Date.now`) and its shrink-retry loop (`for (;;)` at line 592) checks elapsed wall-clock time against a new `ERC8004_CHAIN_BUDGET_MS` constant, writing a cursor row via the existing `INSERT ... ON CONFLICT` shape and returning rather than continuing once the budget is exceeded.
- `ERC8004_CHAIN_BUDGET_MS` is set well under `CRAWL_BUDGET_MS` (240_000).
- A new test in `tests/agent-index.test.js` proves, with a hand-cranked clock and a mocked RPC/DB, that a chain whose every `eth_getLogs` call keeps getting range-rejected now writes a cursor update within the bounded time instead of running unobserved, confirmed to fail against the pre-fix code first (for whichever actual reason the pre-fix code fails, stated in the report).
- `npx vitest run tests/agent-index.test.js` passes in full, including every pre-existing test in the file.
- `npm run check:rules -- --paths "api/cron/[name].js" tests/agent-index.test.js` passes.
- `git diff` reviewed; every changed line traces to a task above.
- The fix is committed on `evolve` with explicit paths and a commit message naming the bug and the fix.
- The report states plainly that Base's live cursor recovery is unverified until this ships, quoting the live frozen row from task 1 as the baseline.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the fix commit SHA and what was verified.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| "I can't be 100% sure which lane is slow or why without a live reproduction, and probing Base's public RPCs risks self-rate-limiting or looking like abuse" | The fix does not depend on knowing which lane is slow or why: it bounds the loop's total wall-clock cost regardless of the cause (slow lane, many shrink iterations, or anything else). Do not hammer Base's public RPC endpoints to "prove" the exact timing; the structural gap (no time bound on this one loop, unlike every sibling loop in the file) is confirmed by reading the code, and the test in task 5 proves the fix with a mock, not a live call | Use mocked `fetch`/`sql` only. Do not make live RPC calls to Base's public endpoints as part of this order |
| "This duplicates order 440 (the health-check severity bug)" | 440 fixes how `indexLagVerdict()` scores a stuck EVM chain's severity once one exists, in `api/_lib/ops/index-lag.js`. This order fixes why Base's crawl itself never completes or persists progress, in `api/cron/[name].js`. Shipping 440 alone leaves Base's cursor frozen forever; shipping this order alone leaves the health check's severity-combining bug in place for the next chain that gets stuck | Fix both; they are independent files and independent bugs |
| "Maybe the real fix is to stop `erc8004RpcCall` from retrying every lane on a definitive JSON-RPC business error (point 5), not to add a time bound to the shrink loop" | That is a real, secondary inefficiency worth noting, but it does not by itself guarantee a bounded time: even with single-lane-only retries, a dense block range can still require several shrink iterations, and a slow single lane can still hang up to its own timeout per call. The time-bound fix in task 3-4 is the one that directly guarantees a DB write within a known ceiling regardless of how many lane-retries or shrink iterations happen upstream of it | Ship the time-bound fix as specified. If time remains, you may also tighten `erc8004RpcCall` to skip remaining lanes on a well-formed `data?.error` response (since it is not lane-specific), but say so explicitly as an addition beyond this order's required scope, with its own test, and do not let it replace the required fix |
| "The budget constant (60s) might still be too long if the invoking request's own timeout is shorter" | This order's fix only needs to be shorter than `CRAWL_BUDGET_MS` (240s) and short enough to plausibly beat common HTTP request timeouts; it does not need to match an exact, unconfirmed external timeout value. A conservative 60s is a large improvement over "no bound at all" regardless of the precise external ceiling | Ship `ERC8004_CHAIN_BUDGET_MS = 60_000` as specified. Do not block on discovering the exact external request timeout value; that is infrastructure configuration, not this order's concern |

## Report format

State: the measured re-derivation from task 1 (the live frozen row, requoted), the code-reading confirmation from task 1's grep, the failing test's first (red) run output and which specific pre-fix failure mode it hit, the fix, the passing test run output (full `tests/agent-index.test.js`), the `check:rules` result, the diff, and the commit SHA. End with one explicit line: "Live production symptom: unverified, pending deploy (Base's cursor will not move until this ships and a cron tick runs)." followed by the current live `erc8004_crawl_cursor` row for chain 8453 as the baseline.
