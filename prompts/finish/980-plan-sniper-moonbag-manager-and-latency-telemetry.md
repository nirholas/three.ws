# Sniper manages retained moon bags and records latency and per-second price telemetry

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/980-plan-sniper-moonbag-manager-and-latency-telemetry.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 38 of 100 inside the tier). **Area:** sniper. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The fleet review found no arm with a positive edge across 1,324 closes, plumbing waste larger than trading loss, and an exit ladder that leaves a moon bag behind and never manages it again. Items 1 to 7 of the plan shipped. Item 9 (moon-bag manager) and item 11 (latency and per-second price telemetry for backtests) are the two code items still marked "next". Without them the retained bags rot unsold and no new strategy can be backtested honestly. The health rollup also reports the sniper `degraded` ("out of trading capital"); that is an owner funding matter and is not part of this order.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `workers/agent-sniper/exit-logic.js` has `moonbagFraction`, `moonbagAlways`, `moonbagExitFraction`, `decideLadderedExit`; `workers/agent-sniper/positions.js` requotes via `requoteCurve` and `requoteGraduated`.
- Migration `api/_lib/migrations/20260725100000_sniper_moonbag_always.sql` added `moonbag_last_quoted_at`, but nothing in `workers/` or `api/` reads or writes it: no manager exists.
- `workers/agent-sniper/executor.js` writes `landed_ms` per trade; there is no per-second price series table and no signal-to-fill latency breakdown.
- Existing tests: `tests/agent-sniper-*.test.js` (amm-exit, graduation-ride, oracle-crossing, signal-flip-exit, ...). Another order, `sniper-experiment-judge-cost-and-exit-giveback`, covers judge cost and giveback; do not duplicate it.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```sh
grep -rn "moonbag_last_quoted_at" workers api --include=*.js | head
grep -rn "landed_ms\|signal_ts\|first_seen" workers/agent-sniper/*.js | head
ls api/_lib/migrations | grep -i sniper | tail -8
npm run db:status 2>&1 | tail -5
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Moon-bag manager in `workers/agent-sniper/` (new `moonbag-manager.js` wired from `index.js`): on an interval, for each open position with `initials_recovered = true` and a retained floor, requote with the existing `requoteCurve`/`requoteGraduated`, stamp `moonbag_last_quoted_at`, trail a stop from the high water mark, and emit a close decision into the same sell path used by exits. Include the stale-clock handling (`updateStaleClock`) so a dead coin with no liquidity is written off rather than quoted forever. Pure decision function in `exit-logic.js`, unit-tested without I/O.
2. Respect `rent-reclaim.js`: a fully exited moon bag closes its token account.
3. Telemetry: add a migration for `agent_sniper_price_ticks` (position id, mint, ts, price, source) sampled once per second only for open positions and the first 120 seconds of each candidate, with a retention rule in `docs/ops/db-retention.md` terms; add columns for `signal_seen_at`, `decision_at`, `sent_at`, `landed_at` so latency per stage is queryable. Write from the existing executor and `positions.js`, not a new poller.
4. Add `scripts/sniper-latency-report.mjs` (read-only SQL) printing p50/p90 per stage per arm.
5. Tests first: `tests/agent-sniper-moonbag-manager.test.js` (decision function table tests for trail, stale, rent close, never selling below the floor logic incorrectly), `tests/agent-sniper-telemetry.test.js` (row shape, retention bound). Run in simulation: use the worker's existing dry-run or `SNIPER_DRY_RUN` mode; add one if it does not exist so no real order is ever sent from a test.
6. Update `workers/agent-sniper/README.md` and `docs/ops/sniper-fleet-review-2026-10-01.md` plan table rows 9 and 11.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm test -- tests/agent-sniper-moonbag-manager.test.js tests/agent-sniper-telemetry.test.js` pass.
- [ ] `grep -rn "moonbag_last_quoted_at" workers` shows reads and writes.
- [ ] `node --env-file=.env scripts/sniper-latency-report.mjs` runs read-only and prints stage percentiles (or an explicit empty state before any ticks exist).
- [ ] A dry-run of the worker against live pump.fun data logs moon-bag decisions without sending a transaction.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Migration status unknown | `npm run db:status` first; migrations apply immediately, so review the SQL before `npm run db:migrate`. |
| No open moon bags to observe | Seed a simulated position through the dry-run harness, never a real wallet. |
| Sniper wallets are starved | Out of scope; build and test in simulation. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Selling real positions, reclaiming rent on mainnet, or funding any sniper wallet is an on-chain action (CLAUDE.md gate 1). The agent builds and simulates only; enabling the manager against live wallets and any real sell is batched into one confirmation at the end of the session with the position list, amounts and token.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/980-plan-sniper-moonbag-manager-and-latency-telemetry.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `980-plan-sniper-moonbag-manager-and-latency-telemetry.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/ops/sniper-fleet-review-2026-10-01.md` (section "Plan and status")

~~~~markdown
## Plan and status

| # | Change | Kind | Status |
|---|---|---|---|
| 1 | Close the token account on every full exit (`workers/agent-sniper/rent-reclaim.js`) | code | committed, ships with the next worker deploy |
| 2 | Ladder: take-profit measured from the ladder price, no max hold on house money, recovered bags free their concurrency slot, `realized_pnl_pct` booked against the original stake (`stake_lamports`, backfilled) | code + migration | committed; migration applied 2026-10-01 |
| 3 | Labeler and three other per-coin lookups: `/coins/` to `/coins-v2/` | code | committed |
| 4 | oracle_crossing: skip graduated coins and dead curves (`SNIPER_CROSSING_MIN_MCAP_SOL`, default 40) | code | committed |
| 5 | Strict LLM arms | decision | not unblocked, see below |
| 6 | `resolveEntrySize` honors the operational floor at every size | code | committed |
| 7 | Global throttle consumed after the wallet check | code | committed |
| 8 | Reclaim stranded rent from empty token accounts (`npm run sniper:reclaim-rent`, dry run measured 1,106 accounts / 2.08 SOL with 3 wallets unread) | on-chain, owner approval | pending approval |
| 9 | Moon-bag manager (re-quote and sell retained floor bags) | code | next; no longer blocking, since a recovered bag now rides open on its trailing stop |
| 10 | Optimizer and evolve | config | switched to shadow on 2026-10-01 (`SNIPER_OPTIMIZER_MODE=shadow`, `SNIPER_EVOLVE_APPLY=0`) until they are re-validated on the corrected % data and fresh Oracle labels |
| 11 | Latency and per-second price telemetry for backtests | code | next |
| 12 | Fund one rebuilt arm with a capped experiment budget | on-chain, owner approval | after 1-7 deploy |

### Decisions recorded

- **Strict LLM arms stay blocked.** Their named models are paid OpenRouter
  models and the worker's key is out of credits. Rotating to the platform's
  fallback keys would bill paid models to keys the platform deliberately keeps on
  `:free` models only (`api/_lib/llm.js`), and the data shows no edge from LLM
  judgment (verdicts select volatility, not direction). The no-new-spend route,
  if wanted later, is Vertex Claude on GCP credits for the Claude-judged arm.
- **The 1% customer trade fee stays.** Since 2026-09-16 every trade on a
  customer-owned agent (Crosshair included) carries the platform's 1% fee per
  side, taking the round trip to ~4.5% with curve fees. It is a revenue feature,
  not a defect, but it raises the bar any customer-owned arm must clear.
~~~~

### `docs/ops/sniper-fleet-review-2026-10-01.md` (section "Defects found")

~~~~markdown
## Defects found

Code defects, with the fix status tracked in the plan below.

1. **Token accounts never closed on exit.** The sell path never closes the
   associated token account, so every trade strands ~0.0015-0.002 SOL of rent.
   2.20 SOL is reclaimable today from 1,162 empty accounts. (Also corrects
   [trading-experiment.md](../trading-experiment.md), which claimed rent was
   limited to winners.)
2. **Take-profit fires right after take-initials.** After the initials leg the
   cost basis is scaled down with the tokens, so the remaining value over the
   remaining basis equals the price multiple (~2x). Any `take_profit_pct` <= 100
   is therefore already met, and the next sweep sells most of the moon bag.
3. **Moon bags are orphaned.** 165 retained bags exist; none has ever been
   re-quoted (`moonbag_last_quoted_at` is null on every row) and no code sells
   them. Their 0.232 SOL of basis is worth ~0.079 SOL and is missing from
   realized PnL.
4. **`realized_pnl_pct` is inflated on every laddered trade.** It divides by the
   post-ladder basis instead of the original stake (one trade is stored as
   +214.6% that truly made +73.4%). That inflated figure feeds the optimizer.
5. **Oracle labeler dead since 2026-09-17.** `frontend-api-v3.pump.fun/coins/:mint`
   now returns 404 while `/coins-v2/:mint` works. `oracle_training_set` stopped
   labeling, `pump_coin_outcomes` is empty, and refits retrain frozen data.
6. **oracle_crossing buys graduated and dead coins.** The crossing query does not
   exclude graduated coins and the curve buy path has no AMM fallback.
7. **Strict LLM arms never trade.** Every OpenRouter call from the worker has
   returned `402 Insufficient credits` since at least 2026-09-01; the judge reads
   only `OPENROUTER_API_KEY` and never rotates to the configured fallback keys,
   so verdicts come from the failover chain and strict arms reject them.
   `SNIPER_LLM_MAX_CONCURRENT=3` is also below the four LLM arms.
8. **Solvency verdicts disagree.** `resolveEntrySize` grants full size once the
   wallet covers size plus headroom without checking the 0.012 SOL operational
   floor, so `/api/sniper/status` calls a 0.00999 SOL wallet "funded" while
   `/api/sniper/experiments` (and reality) call it dry.
9. **Dry arms consume the global throttle.** The 10-buys-per-minute throttle is
   taken before the wallet check, so starved arms crowd out the one funded arm.
10. **The 2026-07-28 agent reclaim was a one-way leak.** It swept house sniper
    wallets below their operating floor into the economy master, but the
    auto-funder draws from a different wallet (the launcher master), so nothing
    flowed back. The floor bug was fixed on 07-30; the SOL never returned.
11. **Optimizer and evolve work against runners.** No cooldown or new-evidence
    requirement (Crosshair's size went 0.0045 to 0.002 in 8 steps over 3 days),
    a rule that lowers take-profit toward the average win, and a win-rate fitness
    in evolve. Both also allocate budget to arms whose wallets cannot trade.
12. **No daily loss breaker.** `SNIPER_MAX_DAILY_LOSS_SOL` is unset and the
    strategy has no such column, so that gate never fires.
~~~~

### `docs/ops/sniper-fleet-review-2026-10-01.md` (section "What would actually make money")

~~~~markdown
## What would actually make money

Being direct about it: nothing in the data supports the claim that any
configuration of this fleet is profitable today, and a six or seven figure
single trade is not a realistic target. A 1000x at today's entry points shows up
about once per 10,000+ entries. To turn one into $100k, a position would need
roughly 3 SOL with a near-perfect exit, or ~42 SOL at the ~20x the best exit
policy actually kept on the largest real runners; a $10k-market-cap curve only
holds ~52 SOL, so the size is not even fillable. Finding it would cost an
expected ~5,000 SOL of drawdown.

What the data does support:

1. **Stop the bleed first.** Close token accounts on exit, reclaim the stranded
   rent, fix the ladder so the bag is real house money, and stop buying graduated
   or dead coins. These are pure losses removed, with no assumption about edge.
2. **Trade only where an edge could exist: fill speed.** The only positive
   simulations needed a fill at the trigger. Measure real detect-to-land latency
   on every entry before tuning anything else.
3. **Use signals to skip, not to buy.** Skip coins with fewer than 2 unique
   buyers, a dev who sold in the first 90 s, serial creators, or a status-URL
   Twitter link. Do not chase smart money, high volume, or a high Oracle score.
4. **Exits wide enough for the asset.** Half off at 2x (initials), then a
   30-45% trail on a free bag with no time limit, beat the fleet's current rules
   under every fill model. It does not fix expectancy on its own, but it is the
   only structure that can capture a runner at all.
5. **Size so fixed costs are noise.** 0.05 SOL minimum per trade. At 0.002 SOL a
   trade cannot win.
6. **Record what a backtest needs.** Per-second price for scored coins, our own
   detect / decide / land timestamps, mayhem mode, and creator history frozen at
   launch time. Without it, exit tuning is guesswork.

The viral outcome worth aiming for is not a dollar figure. It is a public,
tamper-evident ledger entry showing an agent's reasoning at entry and a clean
100x-1000x capture on a free moon bag, verifiable by anyone. That story works at
0.05 SOL, and it is only possible once defects 1-3 are fixed.
~~~~

