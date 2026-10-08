# 400. Stop the x402 ring leak scanner from burning the Solana RPC quota

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate. Written by the evolve scout lane on 2026-10-08 from the measurements below.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order needs none of them until the ship. The scanner is strictly read-only on chain and must stay that way.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Test fixtures are captured, real-shaped RPC payloads and are named as fixtures.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters (measured 2026-10-08, 17:30 UTC, production on `fe2a8b24f`, revision `three-ws-api-00479-d7z`)

`/api/cron/x402-ring-leak-scan` (`api/cron/x402-ring-leak-scan.js`) is the alarm that says SOL or USDC left the controlled-wallet set. Right now it is the single largest consumer of server time in production and very likely the reason every paid Solana RPC plan is exhausted.

| Probe | Result |
|---|---|
| `SELECT count(*) FROM x402_ring_wallets WHERE enabled` | **2,006** wallets (3 created 2026-07-19, 3 on 2026-08-06, **2,000 on 2026-09-22**) |
| Scanner loop | `ringScanWallets()` returns all 2,006, then `for (const wallet of wallets)` calls `getSignaturesForAddress` on each **sequentially**, every run, with no time budget and no single-flight lock |
| Callers | Cloud Scheduler `*/10` (UA `Google-Cloud-Scheduler`) **plus** `api/cron/economy-tick.js` `TARGETS` (`label: 'ring-leak-scan'`), which fires it every 2 minutes (UA `threews-economy-tick/1.0`) |
| Run latency, last 24h | p50 **765 s**, max 900 s (Cloud Run's request cap). 70 runs in 3 hours, 5 of them 504 at 899.9 s. 504 counts: 20 on 10-06, 71 on 10-07, 24 on 10-08 |
| Busy time, 3 hours | **53,136 request-seconds**, about 5 scans running concurrently at all times, 60% of all cron busy time (next: `run-buyback` 8,063 s) |
| Cursor table | `x402_ring_scan_cursor`: 109 rows of 2,006 wallets ever recorded, newest `updated_at` **2026-10-03 19:26**, none in the last 24h. A wallet with no new signatures returns before a cursor is saved, so 1,897 never-active wallets are re-queried from scratch on every run |
| `x402_ring_fee_observed` | **empty**: the fee cross-check (task 05 of the original design) has never recorded a day |
| `/api/healthz` | `helius` degraded (quota), `rpc_lanes` "all 2 paid lanes exhausted", `agent_index` degraded on 37m lag. OWNER-ACTIONS row 24 asks the owner to top up the paid plans after 45,461 Helius `429: max usage reached` lines in 24h |
| `vercel.json` `functions` | declares `maxDuration: 300` for this handler, but `server/index.mjs` never reads `maxDuration` (`grep -n maxDuration server/*.mjs` is empty), so the only cap is Cloud Run's 900 s |

Arithmetic: about 23 runs an hour times about 2,006 `getSignaturesForAddress` calls is roughly 46,000 RPC calls an hour, over 1.1 million a day, from one read-only monitor. Topping up the plan (OWNER-ACTIONS row 24) before this is fixed buys a few days. The same failure class already happened once and is documented in `economy-tick.js` itself: `three-holders-snapshot` was removed from `TARGETS` because firing it every minute "multiplied the Helius DAS walk".

## Step 0: re-derive the current state

Nothing above may be trusted until you re-measure it. `.env.local` carries `DATABASE_URL`; run DB reads with a short node script using `@neondatabase/serverless` (delete the script afterwards, never commit it to the repo root).

    curl -s https://three.ws/api/version
    git log --oneline -1 && git log --oneline -15 -- api/cron/x402-ring-leak-scan.js api/cron/economy-tick.js
    grep -n "ring-leak-scan" api/cron/economy-tick.js vercel.json
    curl -s https://three.ws/api/healthz | python3 -c "import json,sys;d=json.load(sys.stdin);[print(s['name'],s['status'],s.get('detail','')[:160]) for s in d['subsystems']['subsystems'] if s['name'] in ('helius','rpc_lanes','agent_index','x402_settle')]"
    gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" httpRequest.requestUrl:"x402-ring-leak-scan"' --freshness=3h --limit=500 --format='value(timestamp,httpRequest.status,httpRequest.latency,httpRequest.userAgent)' --project aerial-vehicle-466722-p5
    gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" textPayload:"max usage reached"' --freshness=24h --limit=1 --format='value(timestamp)' --project aerial-vehicle-466722-p5

DB reads: `SELECT count(*) FILTER (WHERE enabled), count(*) FROM x402_ring_wallets`, `SELECT count(*), max(updated_at) FROM x402_ring_scan_cursor`, `SELECT count(*) FROM x402_ring_fee_observed`.

Also establish which ring wallets can actually move money and how the platform already knows when they did. Read `api/_lib/x402/ring-allowlist.js` (`ringRoleWallets`), `api/_lib/x402/pool.js`, `api/_lib/x402/agents/index.js` and the migrations that create `x402_ring_wallets` (`api/_lib/migrations/2026-07-01-x402-ring-economy.sql`, `2026-07-03-x402-ring-agents.sql`, `2026-07-17-x402-ring-pool.sql`) to find the ledger rows (payments, settles, sweeps, top-ups) that name a payer or receiver pubkey and a timestamp. That ledger is how the scanner can know which of the 2,006 wallets had activity since the last run without asking the chain about every one.

If production already shows run latency under 60 s and the cursor table advancing, the fix shipped: verify each Definition of done line and close out.

## Tasks

1. **Single-flight.** Wrap the handler body in `acquireLock(key, ttlSeconds)` / `releaseLock(key)` from `api/_lib/cache.js` (read how `api/_lib/changelog-push.js` uses its lock first). A second caller while a scan holds the lock returns `200 { ok: true, skipped: true, reason: 'scan_in_progress' }` in milliseconds. The lock TTL must exceed the run budget in task 2 so a crashed run cannot wedge it longer than one budget.
2. **A wall-clock budget, modeled on `api/cron/quality-bench.js`** (`BUDGET_MS`, `deadlineAt`). Stop starting new wallets once the budget is spent, persist cursors for every wallet finished, and return `200` with `partial: true` and `remaining: <n>`. Budget: 240 s, under the declared `maxDuration: 300`. A run must never again end in a 504.
3. **Scan what can leak, not everything that exists.** Each run scans, in order: (a) every role wallet from `ringRoleWallets()` (the few that hold real balances), (b) every registry wallet the platform's own ledger shows sent, received, settled or was swept since its cursor (from the tables found in step 0), then (c) a rotating slice of the remaining registry wallets, oldest `checked_at` first, sized to fit the budget. Record a per-wallet `checked_at` even when there are zero new signatures (add the column with a NEW migration under `api/_lib/migrations/`, never by editing an applied one; keep the in-handler `CREATE TABLE IF NOT EXISTS` in step). A never-funded wallet then costs one call per full rotation, not one per run. Leak-detection guarantee to preserve and state in the handler header: every wallet is still checked at least once per rotation, and any wallet with ledger activity is checked on the next run. Classification (`classifyWalletDebits`) and the alert path stay byte-for-byte unchanged in behavior; `tests/x402-ring-leak-classify.test.js` must pass untouched.
4. **Bounded concurrency inside the budget.** Replace the strict sequential loop with a small fixed pool (4 to 8 in flight) so a run finishes the hot set in seconds. Do not add a new dependency for this if a pool helper already exists in `api/_lib/` (search first).
5. **Take it off the 2-minute tick.** Remove the `ring-leak-scan` entry from `TARGETS` in `api/cron/economy-tick.js` and leave a comment beside the existing `three-holders-snapshot` note explaining why (its own `*/10` Cloud Scheduler job owns it, and the tick fired it every 2 minutes on top of that). Check `wallets-leak-scan` in the same list: it is fast today (p50 4.2 s) but has the same shape; give it the same single-flight lock.
6. **Fix the fee cross-check.** Find why `x402_ring_fee_observed` has never received a row (`accrueObservedFee` runs after the wallet loop, which a 900 s kill never reaches; confirm or find the real reason) and make a partial run still accrue what it observed.
7. **Tests** in `tests/x402-ring-leak-scan-budget.test.js`: the lock skip path, a run that hits the budget returns `partial: true` with cursors saved for completed wallets, the wallet-selection order (role wallets, then ledger-active, then rotation), and a zero-signature wallet getting `checked_at` stamped. Each test must fail against the pre-fix handler.
8. **Docs.** Update the "Every paid Solana RPC lane exhausted at once" section of `docs/ops/production-log-triage.md` with this cause and how to recognize it (scanner latency, concurrent runs), and correct OWNER-ACTIONS row 24 in `prompts/finish/_context/production-100-OWNER-ACTIONS.md`: the top-up is still the owner's, but say it should follow this deploy, with the measured call volume.
9. **Changelog.** This is infrastructure reliability users feel as faster balances and agent pages; add a `data/changelog.json` entry tagged `infra` in plain language, then `npm run build:pages`.

## Definition of done

- [ ] `grep -n "ring-leak-scan" api/cron/economy-tick.js` shows no `TARGETS` entry (a comment is fine).
- [ ] `npx vitest run tests/x402-ring-leak-scan-budget.test.js tests/x402-ring-leak-classify.test.js` exits 0, and the new file failed on the pre-fix handler: write the test file before touching the handler, run it, and paste its failing output into the report.
- [ ] A local run against mainnet (`npm run dev` on a free port, not 3000, then `curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:<port>/api/cron/x402-ring-leak-scan`) returns `200` in under 260 s with a `results` array, and a concurrent second curl returns `scan_in_progress`. If `CRON_SECRET` is not in `.env.local`, read it with `node scripts/read-service-env.mjs '^CRON_SECRET$' --raw` and never print it.
- [ ] The new migration file exists, `npm run db:status` lists it as pending, and it is NOT applied (owner ships it with the deploy).
- [ ] `npm run test:core` shows no new failures versus the step 0 baseline (record both counts).
- [ ] `npm run check:rules -- --paths <files you touched>` exits 0; `npm run build:pages` exits 0.
- [ ] A dated row in `prompts/finish/_context/production-100-OWNER-ACTIONS.md` names the ship command (`npm run deploy:gcp:full` after `npm run db:migrate`) and the post-deploy check: the 3-hour log query in step 0 shows p50 under 60 s, zero 504s, and no `threews-economy-tick/1.0` callers.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Production is behind `main`, so the fix cannot be proven live | Prove it locally against mainnet RPC; record the production baseline; the deploy is the owner's one step, recorded in OWNER-ACTIONS. |
| Local RPC is throttled because the paid lanes are exhausted | That is the bug's own symptom. The free lanes in `api/_lib/solana/connection.js` still answer; a slower local run is fine as long as the budget holds and the lock works. |
| No ledger table cleanly names "wallet had activity since T" | Use the closest real signal you find (settle log payer, sweep log, top-up log) and document the gap in the handler header; the rotation in task 3(c) is the backstop that keeps the guarantee. Never fall back to scanning all 2,006 per run. |
| The 2,000 wallets added 2026-09-22 look like they should be disabled instead | Disabling ring wallets changes the economy; do not. Record the observation in the report. |
| `db:migrate` is denied | Expected. Write and test the migration; it applies at deploy through the `db:check` gate. |
| Unrelated test files are already red | Baseline them in step 0 and require no new failures; order 401 owns the suite. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff, e.g. `fix(x402): scan only ring wallets that can have moved, under a lock and a budget, so the leak scan stops draining the RPC quota`.
3. If every line passes, delete this file in that same commit (`git rm prompts/finish/400-auto-ring-leak-scan-rpc-burn.md`) and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHAs. If a line cannot pass in this session, leave the file, log which line remains and who owns it.
4. Final report, in this order: what step 0 measured; what changed (files with commit SHAs); evidence per Definition of done line; the OWNER-ACTIONS row text; one-line judgment calls. No trailing questions.
