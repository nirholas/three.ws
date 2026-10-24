# 427. Ten more crons silently truncate at wrapCron's 120s default despite a declared 300s budget

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, `git push` or a production deploy, posting to an external channel, committing content that references a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them.
- No mocks, no fake data, no TODO markers, no commented-out code, no `it.skip`/`.todo` to make a failure disappear.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before each commit, commit promptly per topical slice.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.
- Bug fixes are test-first (CLAUDE.md): confirm each fix's test fails for the stated reason before changing the code, fix, then confirm it passes. Commit the test with the fix.

## Why this matters (measured 2026-10-24)

Two commits landed on `evolve` earlier today fixing the exact same bug in two places:

- `5814b5585` fixed `api/cron/x402-ring-leak-scan.js`: declared `maxDuration = 300` in `vercel.json`, but the file never passed `maxDurationMs` into `wrapCron()`, so `api/_lib/http.js`'s `wrapCron` fell back to `DEFAULT_CRON_MAX_DURATION_MS` (120,000 ms) and killed every run at ~120s with a `503 cron_timeout`, a 100% failure rate over a 6h sample.
- `2e7c0f555` fixed `api/cron/[name].js` (the shared dispatcher behind 30+ `HANDLERS` jobs including `run-buyback` and `solana-agents-crawl`) the same way.

`DEFAULT_CRON_MAX_DURATION_MS` is defined at `api/_lib/http.js:778` as `120_000`; `wrapCron(handler, { maxDurationMs })` at line 780 uses it whenever the caller omits the option. This scout pass cross-referenced every `vercel.json` `functions` glob that declares `maxDuration: 300` against the `api/cron/*.js` files it covers, and found the SAME unwired bug, confirmed by source inspection (`grep -n maxDuration` on each file shows no local export and no `wrapCron(..., { maxDurationMs })` second argument), in **ten more standalone cron handlers that were never touched by either fix**:

| File | Cron schedule (`vercel.json`) | Declared budget | Wired today |
|---|---|---|---|
| `api/cron/economy-reconcile.js` | `*/30 * * * *` | 300s | No |
| `api/cron/x402-prepaid-settle.js` | `23 * * * *` | 300s | No |
| `api/cron/fact-check-benchmark.js` | `41 4 * * 1` | 300s | No |
| `api/cron/avaturn-seed-cron.js` | `* * * * *` | 300s | No |
| `api/cron/strategy-fanout.js` | `*/2 * * * *` | 300s | No |
| `api/cron/gmgn-seed.js` | `0 3 * * *` | 300s | No |
| `api/cron/recompute-reputation.js` | `*/10 * * * *` | 300s | No |
| `api/cron/smart-money-graph.js` | `*/10 * * * *` | 300s | No |
| `api/cron/sketchfab-showcase.js` | `0 15 * * 1,3,5` | 300s | No |
| `api/cron/forge-smoke.js` | `30 9 * * *` | 300s | No |

Live proof this is not theoretical for the most frequent one:

    npm run logs -- --grep "economy-reconcile" --since 24h --http 503 -n 20

returns (measured 2026-10-24 09:2x UTC):

    2026-10-24 00:22:12Z ERROR [three-ws-api] 503 GET https://three.ws/api/cron/economy-reconcile 120.00s
    2026-10-24 01:00:03Z ERROR [three-ws-api] 503 GET .../api/cron/economy-reconcile 120.00s
    2026-10-24 06:00:01Z ERROR [three-ws-api] 503 GET .../api/cron/economy-reconcile 120.29s

Three truncated runs in 24h at exactly the 120s signature, on a cron that reconciles the economy ledger every 30 minutes. The other nine run less often (hourly to weekly) or finished under 120s in this particular window, which is why they show no 503 yet; they carry the identical latent defect and will truncate the moment their workload crosses 120s, same as `x402-ring-leak-scan` did at 100% failure once its backlog grew. `recompute-reputation.js` and `smart-money-graph.js` run every 10 minutes against growing tables (trust scores, wallet clustering), so they are the next most likely to tip over.

No audit in the repo currently catches this class across all crons; the two existing fixes were each found by hand from a log signature, after the fact. This order both repairs the ten known instances and adds the audit so a future cron added with a mismatched budget fails the gate instead of waiting for a production 503 storm.

## Step 0: re-derive the current state

    git log --oneline -3 -- api/cron/economy-reconcile.js api/cron/x402-ring-leak-scan.js api/cron/\[name\].js
    grep -n "maxDuration" api/cron/economy-reconcile.js api/cron/x402-prepaid-settle.js api/cron/fact-check-benchmark.js api/cron/avaturn-seed-cron.js api/cron/strategy-fanout.js api/cron/gmgn-seed.js api/cron/recompute-reputation.js api/cron/smart-money-graph.js api/cron/sketchfab-showcase.js api/cron/forge-smoke.js
    npm run logs -- --grep "economy-reconcile" --since 24h --http 503 -n 20

If any of the ten files already shows a `maxDurationMs` wired into its `wrapCron(...)` call (another agent may have fixed it first), drop that file from the task list below and note it in the report; do not re-fix it.

## Tasks

1. For each of the ten files, apply the same two-part fix the precedent commits used:
   - Add `export const maxDuration = 300;` near the top of the file, beside the other named exports (follow the placement and the explanatory comment style already used in `api/cron/quality-bench.js:23` and `api/cron/x402-ring-leak-scan.js`, which both read `vercel.json`'s declared value into a local constant rather than hardcoding `300` twice).
   - Change the closing `});` of the `export default wrapCron(async (req, res) => { ... });` call to pass the options object: `}, { maxDurationMs: maxDuration * 1000 });`. For `api/cron/recompute-reputation.js`, which already closes with `}, { requireWriteCapacity: true });`, merge the new key into the existing object rather than adding a second one: `}, { requireWriteCapacity: true, maxDurationMs: maxDuration * 1000 });`.
2. Write one regression test per file (or one parametrized test covering all ten, following the shape of the existing `tests/cron-dispatcher-routing.test.js` maxDuration assertion and `tests/x402-ring-leak-scan-run.test.js`'s "cron timeout wiring" describe block) that: imports the handler module, reads its exported `maxDuration`, reads `vercel.json`'s declared `maxDuration` for that route from the matching `functions` glob key, and asserts they are equal and both exceed `DEFAULT_CRON_MAX_DURATION_MS` (import that constant from `api/_lib/http.js` rather than hardcoding `120000`). Confirm each test fails against the pre-fix file (checkout the file at HEAD before editing, run the test, see it fail because `maxDuration` is `undefined`), then fix, then confirm it passes.
3. Add a standing audit so this class cannot recur silently: a new script, `scripts/check-cron-budget-wiring.mjs` (follow the style of `scripts/check-cron-drift.mjs`: parse `vercel.json`'s `functions` object, expand each glob key, for every expanded path matching `api/cron/*.js` with a declared `maxDuration` strictly greater than `DEFAULT_CRON_MAX_DURATION_MS / 1000` (120), statically import the module and confirm it exports a `maxDuration` whose value, times 1000, is reachable as the `maxDurationMs` wrapCron receives. Static import plus reading the module's own exported `maxDuration` is sufficient; you do not need to parse the AST for the literal `wrapCron(...)` call site, because the convention this codebase already uses (confirmed in `quality-bench.js`, `likeness-eval.js`, `marketplace-escrow-sweep.js`, `labor-escrow-sweep.js`, and now these ten) is that the exported `maxDuration` constant IS what gets passed as `maxDurationMs: maxDuration * 1000`, so a file that exports the right constant but forgets to wire it is the one gap this script cannot catch from exports alone. Close that gap properly: have the check actually invoke `wrapCron`'s module-level default export shape is opaque (it returns a closure), so instead read each target file's source text and assert, with a regex anchored on the literal pattern `maxDurationMs: maxDuration * 1000` (or `maxDurationMs: <exportedConstantName> * 1000`) appearing in the `wrapCron(` call's option object. This is the same shape `tests/x402-ring-leak-scan-run.test.js` already verifies for one file; generalize it across all matching files instead of duplicating it ten more times by hand.
4. Add `check:cron-budget-wiring` to `package.json`'s `scripts` block beside the other `check:cron-*` entries, and add it to the `gate` script's chain (insert it next to `check:cron-syntax` in the `&&` sequence) so a future cron with this same mismatch fails CI instead of waiting for a log signature.
5. Run `npm run check:cron-budget-wiring` against the full `api/cron/` tree and confirm it reports clean for all ten fixed files plus the two precedent files, with no new false positives across the other ~140 cron files.

## Definition of done

- [ ] All ten files in the table export `maxDuration = 300` and wire `maxDurationMs: maxDuration * 1000` (merged correctly for `recompute-reputation.js`) into their `wrapCron` call.
- [ ] A regression test exists per file (or one parametrized test enumerating all ten) and passes; each was confirmed to fail before the fix.
- [ ] `scripts/check-cron-budget-wiring.mjs` exists, is wired as `npm run check:cron-budget-wiring`, is added to the `gate` script chain in `package.json`, and exits 0 against the current tree.
- [ ] `npm run test:core` exits 0 (or shows no new failures versus the pre-existing baseline order 401 already tracks; do not treat order 401's unrelated failures as caused by this change).
- [ ] `npm run check:cron-syntax` and `npm run check:rules -- --paths <files you touched>` both exit 0.
- [ ] Commit message names the ten files and the new audit script.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Another agent already fixed one or more of the ten files | Routine for a shared worktree; the two precedent fixes landed hours before this order was written | Re-run step 0's grep first; skip any file that already has `maxDurationMs` wired, fix only the rest, say which were already done in the report |
| Unsure whether `recompute-reputation.js`'s `requireWriteCapacity: true` should stay | It should; this order only adds a key to that object, never removes one | Merge `maxDurationMs` into the existing options object, do not replace it |
| The new audit script flags a cron this order did not list | The sweep that produced the table above was manual; a false negative is possible | Fix it too if the cause is the same wiring gap; if it is a different shape (e.g. a file with a legitimately lower budget than `vercel.json` declares, which is not this bug), document why it is a false positive and exclude it by name with a one-line comment in the script, never by weakening the general check |
| `npm run test:core`'s pre-existing failures (order 401) make the suite noisy | Order 401 owns the general cleanup | Only verify your own new tests pass and that you introduced no new failing file; do not attempt to fix order 401's list here |

## Report format

1. Per file: the exact diff hunk (export line + wrapCron closing line).
2. The new test file(s) and the pre-fix failing run output proving each was a real regression test, not written to match the fix.
3. `scripts/check-cron-budget-wiring.mjs`'s full run output against the whole `api/cron/` tree (clean) and confirmation it is wired into `gate`.
4. `npm run test:core` summary line, before and after.
5. Commit SHA(s).
