# Cut Solana RPC call volume with per-route accounting, request coalescing and a short fresh-read cache

**Status (2026-11-13, later):** A third 24h window (2026-11-12 17:00 to 2026-11-13 17:00 UTC, prod still on 0d4c38210) read 1,332,768 provider calls with 83,038 saved (5.9%), so the 40% target is still unmeasured against any of the undeployed cuts. Three more source cuts are committed, each test-first: run-buyback reads every curve and buyback vault in getMultipleAccounts batches and skips empty vaults without per-coin reads, with a fresh re-read before any swap or burn (c849af6e8, about 45k calls/day); due-diligence shares each mint's launch for 7 days and each holder's first receipt for 6 hours across instances (a8a09e2c3, about half of 72k); recompute-reputation only re-scores current-version scores older than REPUTATION_RECOMPUTE_MIN_AGE_H, default 12 (9e8a3fd97 and ba15f3e39, about 39k). Docs and changelog: ea9493d0d. Together about 120k calls/day on top of the claims cut, the sweep cut and the attempt cap. What remains belongs to the owner: `git push threews main`; fund the x402 sponsor WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW (SOL) and the seeder X4o2UuVNMxnrgkzVy97kPF5gmS6CLRCVJGB48VastML (USDC account); `npm run deploy:gcp:full`; then 24h later run `node scripts/rpc-spend-report.mjs --base https://three.ws --hours 24` and compare against 1,332,768 total with blockhash_expired not rising.

**Status (2026-11-13):** Production is still on commit 0d4c38210 (built 2026-11-11). The 2026-11-12 source cuts were pushed but never deployed: revision 00533 was config-only. A second 24h window, to 2026-11-13 15:00 UTC, is therefore another pre-cut baseline: 1,265,666 provider calls, 5.8% saved. The top pairs are pump-fun-mcp getTransaction 155,947 and attestations-crawl getSignaturesForAddress 132,366. The next lever named below shipped test-first: a non-money read now tries at most `RPC_READ_MAX_ATTEMPTS` lanes (default 3) per phase, and money callers stay uncapped (`tests/solana-rpc-attempt-cap.test.js`, 94 connection-layer suites green, docs in `docs/ops/solana-rpc-lanes.md` "Second window and the attempt cap"). `blockhash_expired` is 0. Verify is at 0 ok since 2026-11-10 16:01 because the x402 sponsor `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` has 0 lamports and the seeder `X4o2UuVNMxnrgkzVy97kPF5gmS6CLRCVJGB48VastML` has no USDC account. That is not an RPC fault. The classification fix is 4be536753. Remaining, all owner-owned: fund the sponsor (SOL) and the seeder (USDC), then run `npm run deploy:gcp:full`. After 24h, run `node scripts/rpc-spend-report.mjs --base https://three.ws --hours 24` against 1,265,666 and record the result in that doc section.

**Status (2026-11-12):** Deployed and measured from the live ledger (24h to 2026-11-12 16:00 UTC): 1,304,108 provider calls, 5.7% saved by cache and coalescing. The 40% target is NOT met. Holders plus security run about 12,306 calls/h against the 10,479/h baseline while their request volume halved (1,750/h against 3,900/h), because the ledger counts every failover lane attempt (about 7 per request against 2.69 modeled logical reads) and the paid lanes were cycling through cooldowns. `blockhash_expired` is 0 on `/api/healthz` (baseline 3). The two new top offenders were cut at the source and committed, test-first: the dormancy-tiered agent sweep with the overdue-minutes sensor (ea488c8cf, 4e3211028; about 1,440 to about 730 logical gSFA/h) and the claims scan (2171923f3: stop on a null read, budget 40 to 12, a 5s incomplete memo and a 30s complete memo). Docs are in 8e26bf6fb (`docs/ops/solana-rpc-lanes.md` "Measured after deploy", `docs/ops/agent-index.md`) and the changelog in 16996a8cd. Remaining, owner: `git push threews main`, `npm run deploy:gcp:full`, then after 24h `node scripts/rpc-spend-report.mjs --base https://three.ws --hours 24` and record the pump-fun-mcp getTransaction (249,658), sweep getSignaturesForAddress (140,729) and total (1,304,108) figures in that doc section. Next engineering lever if the target is still missed: cap failover attempts per logical read.

**Status (2026-11-04):** Code, tests, docs and changelog are committed (409dc1318, cc519689e, 9a36a7353, 47d2502dc, 7a39eee75, 9e63a890b, 5a1c390fe). Per-call accounting by caller, method and lane, `/api/ops/rpc-spend`, `scripts/rpc-spend-report.mjs`, in-flight coalescing, the per-method fresh-read cache with `fresh: true` on money paths, the fleet-wide shared read tier, `RPC_LANE_BUDGETS` and `calls_24h` plus the top caller in `rpc_lanes` are in. RPC suites 51/51, crypto 45/45 and subsystem-health 41/41 pass in a clean-deps copy. A local API run printed non-zero calls (9) and saves (2, holders served from the reads security had just made). The production offenders are measured in `docs/ops/solana-rpc-lanes.md` (top 3: /api/crypto/holders, /security, /bonding, all from one client scanning 755 mints), and the three source cuts replay to 10,479 to 5,968 calls/h (43.0%). Remaining, owner: `git push threews main`, then `npm run deploy:gcp:full`. After 24h live, run `node scripts/rpc-spend-report.mjs --base https://three.ws --hours 24` and record the real reduction against the 10,479/h baseline, with `blockhash_expired` at or below 3, in the doc's "Measured offenders" section.

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/268-plan-solana-rpc-call-volume-budget-and-read-cache.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 72 of 100 inside the tier). **Area:** solana. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Production Solana reads and every x402 settle share one rotating endpoint chain (`solanaRpcEndpoints()` in `api/_lib/solana/connection.js`). Right now `/api/healthz` reports `rpc_lanes: all 2 paid lanes exhausted; serving from 0 free lanes` and `helius: quota cooldown, on public RPC`. The platform stays up only by hopping across free lanes that each refuse some call shapes, which shows up as intermittent 5xx, slow settles and `broadcast_failed` (20 of the last 4,768 settles) and `blockhash_expired` verifies. GCP credits cannot buy a Solana node (Blockchain Node Engine is Ethereum-only) and buying plan upgrades is the owner's decision, so the fix an engineer can ship now is to make far fewer calls: know who spends the quota, coalesce duplicate in-flight reads and cache hot reads for a few seconds.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_lib/solana/connection.js` (1,790 lines) implements priority and breaker logic, method-capability routing, transport fallback and a LAST-GOOD stale cache (15 minute TTL, written at most once a minute per key, only served when every lane fails). There is no fresh-read cache, no in-flight coalescing across concurrent identical requests, and no per-route or per-caller accounting of calls.
- Tests exist for routing and breakers: `tests/solana-rpc-priority-and-breaker.test.js`, `solana-rpc-rotating-fetch.test.js`, `solana-rpc-method-capability.test.js`, `solana-rpc-transport-fallback.test.js`, `rpc-rate-limit.test.js`, `money-rpc-resilience.test.js`.
- Probe tool: `scripts/probe-rpc-lanes.mjs`. Lane facts and measured matrix are in `docs/ops/solana-rpc-lanes.md`.
- Health: `api/_lib/health-probes.js` and `api/_lib/ops/subsystem-health.js` expose `rpc_lanes` and `helius`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```sh
curl -s https://three.ws/api/healthz | python3 -c "import json,sys;d=json.load(sys.stdin);[print(s['name'],s['status'],s.get('detail')) for s in d['subsystems']['subsystems'] if s['name'] in ('rpc_lanes','helius')];print(d['x402']['self_facilitator'])"
grep -n "coalesc\|inflight\|callAccounting\|byRoute" api/_lib/solana/connection.js | head
node --env-file=.env scripts/probe-rpc-lanes.mjs 2>&1 | tail -25
grep -rn "getTokenAccountsByOwner\|getBalance\|getAccountInfo" api --include=*.js -l | wc -l
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Accounting first: add a lightweight per-call counter in the connection layer keyed by `(route or caller tag, method, lane)` stored in the shared cache in hourly buckets (reuse `cacheSet`/`cacheGet` in `api/_lib/cache.js`; do not add a vendor), with a caller tag taken from an AsyncLocalStorage context set by the API router in `server/index.mjs` (path) and by crons (name). Add a read-only endpoint or `scripts/rpc-spend-report.mjs` that prints the top 20 `(caller, method)` pairs by calls in the last 24 hours.
2. Measure: run the report against production for a real window and write the top offenders into `docs/ops/solana-rpc-lanes.md` with call counts. Do the next tasks in the order the data dictates.
3. In-flight coalescing: identical concurrent read requests (same method and params, commitment included) share one upstream promise. Never coalesce `sendTransaction`, `simulateTransaction` or anything with a signature the caller will act on.
4. Fresh-read cache with explicit TTLs by method: `getLatestBlockhash` 2 s (must stay under the blockhash validity window and never serve a blockhash older than the verify path tolerates), `getBalance`/`getTokenAccountsByOwner`/`getAccountInfo` 3 to 5 s unless the caller passes `{ fresh: true }`, `getSignatureStatuses` never cached for pending signatures, 30 s once finalized. Settle, send and verify paths pass `fresh: true`. Tests first in a new `tests/solana-rpc-read-cache.test.js`: hit, expiry, fresh bypass, error not cached, no coalescing for writes.
5. Cut the top three offenders at the source (batch with `getMultipleAccounts`, raise a poll interval, memoize a holder gate for a minute) and record the before and after call counts.
6. Add a daily budget guard: when a paid lane's call count crosses a configurable fraction of its known quota (`RPC_LANE_BUDGETS` JSON env), demote it for non-money callers first so settles keep the paid lane. Test in `tests/solana-rpc-priority-and-breaker.test.js`.
7. Surface `calls_24h` and the top caller in the `rpc_lanes` health detail so the next quota event tells the on-call who spent it.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm test -- tests/solana-rpc-read-cache.test.js tests/solana-rpc-priority-and-breaker.test.js tests/money-rpc-resilience.test.js` pass.
- [ ] `node --env-file=.env scripts/rpc-spend-report.mjs` prints a ranked table with non-zero counts after a local run of the API.
- [ ] `docs/ops/solana-rpc-lanes.md` records before and after call counts for the top three offenders, with at least a 40 percent reduction in total calls per 24 hours measured after deploy (state the measured value).
- [ ] x402 self-facilitator `verify` rejection `blockhash_expired` does not increase relative to the pre-change figure in `/api/healthz`.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Paid lanes are over quota so the probe shows little | Run the report from the cache counters, which do not need a healthy lane; the probe script still ranks free lanes by call shape. |
| Wanting to buy a plan or a node | Not the task; reduce volume and document the residual need in the report for the owner. |
| Cannot reproduce production traffic locally | Replay a recorded request mix from the counters in a test harness; do not mock results as if live. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/268-plan-solana-rpc-call-volume-budget-and-read-cache.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `268-plan-solana-rpc-call-volume-budget-and-read-cache.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/ops/ISSUES.md`
- `docs/ops/solana-rpc-lanes.md`
- `docs/ops/production-log-triage.md`
