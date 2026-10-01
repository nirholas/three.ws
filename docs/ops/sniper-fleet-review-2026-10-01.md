# Sniper fleet review (2026-10-01)

An in-depth review of the autonomous pump.fun sniper fleet before any new money
goes into it: how every arm has actually traded since the first live fill, what
the rails do, where the money went, and what the data says it would take to make
an arm profitable. Everything here was measured read-only against production
(the `agent_sniper_*` tables, the decision ledger, on-chain wallet state, the
public pump.fun coin and candle APIs, and the live `agent-sniper` Cloud Run
config). No funds were moved to produce it.

Related: [docs/agent-sniper.md](../agent-sniper.md) (how the system works),
[docs/trading-experiment.md](../trading-experiment.md) (the 10 SOL experiment
spec), [trading-bot-report.md](trading-bot-report.md) (`npm run bots:report`).

## The short version

1. **No arm has a positive edge.** 1,324 real closes from 2026-07-03 to
   2026-10-01: 16.5% win rate, -10.8% mean per trade (95% CI -13.0% to -7.0%),
   -0.543 SOL realized on 9.47 SOL staked. No arm's confidence interval clears
   zero. Replaying the fleet's own exit rules, and the best alternatives, against
   ~10.5k recent launches at 1-minute resolution reaches the same answer: every
   policy is negative at a realistic fill.
2. **Plumbing cost more than trading.** Every buy opens a token account and the
   sell never closes it. The 11 sniper wallets hold 1,377 token accounts with
   2.61 SOL of rent locked, 4.8x the realized trading loss. 2.20 SOL of it sits in
   1,162 already-empty accounts. At 0.002 SOL per trade the unclosed rent alone
   needs a ~79% move to break even. This, not trading, is why most arms are dry.
3. **The exit logic cannot hold a runner.** A take-profit fires on the sweep
   right after take-initials (cost-basis bug), the moon bag left behind is never
   managed again, and max-hold timeouts cut house money. The ladder the thesis
   depends on does not work as designed.
4. **The only trading arm enters late.** Crosshair's oracle-crossing trigger
   fires on coins that have already moved: 53% of its attempts hit coins that
   had already graduated, half its fills were after the coin's all-time high, and
   36% of its trades bought dead curves under ~40 SOL market cap.
5. **The learning loops are blind or counterproductive.** The Oracle outcome
   labeler has written nothing since 2026-09-17 (the pump.fun endpoint it calls
   now 404s), so every refit retrains on frozen data. The optimizer ratcheted
   Crosshair down to dust size and pulls take-profit toward the average win,
   which caps runners. Evolve ranks arms on win rate, which penalizes exactly the
   low-hit-rate, high-payoff shape a runner strategy has.

## How the fleet traded

| Arm | Trades | Win | Net SOL | Mean / trade | 95% CI |
|---|---|---|---|---|---|
| Crosshair (oracle_crossing, score 85+) | 781 | 16.6% | -0.116 | -12.0% | -14.8 to -9.3 |
| Moe Money AI (oracle, open) | 294 | 4.1% | -0.099 | -10.3% | -17.3 to +2.3 |
| Boost Ride (graduation_ride) | 90 | 63.3% | -0.027 | -3.0% | -8.7 to +2.3 |
| Nadirah (intel, quality) | 46 | 2.2% | -0.166 | -15.2% | -22.1 to -6.1 |
| Swarm 2 (LLM, grok) | 33 | 36.4% | +0.003 | +0.8% | -10.1 to +12.3 |
| Swarm 5 (LLM, auto) | 29 | 10.3% | -0.005 | -4.1% | -12.8 to +5.8 |
| Swarm 9 (LLM, claude) | 14 | 7.1% | -0.018 | -12.8% | -27.4 to -1.8 |
| Midas, three, luna, Swarm 7 | 37 | 0-20% | -0.115 | -10 to -28% | |
| **Fleet** | **1,324** | **16.5%** | **-0.543** | **-10.8%** | **-13.0 to -7.0** |

Removing the single best trade (a +0.367 SOL win on a 0.5 SOL stake) moves the
fleet to -0.91 SOL and Crosshair to -0.48 SOL.

### Exits

| Exit reason | Share | Mean | Median hold | SOL |
|---|---|---|---|---|
| liquidity_decay | 36% | -8.4% | 471 s | -0.128 |
| stop_loss | 24% | **-50.8%** | 52 s | **-0.679** |
| trailing_stop | 23% | -2.7% | 78 s | -0.234 |
| timeout | 11% | +10.0% | 1,804 s | -0.060 |
| take_profit | 5% | +87.8% | 172 s | +0.558 |

- **Stops gap far past their setting.** A 30-35% stop realizes a median -43%
  (-47.5% on Crosshair); 36% of stop exits land worse than -50%. Exits are swept
  every 5 s, serially, and sold with no tip on a 1,000 microlamport/CU fee floor.
- **The trailing stop is a second stop-loss.** 74% of trailing exits are below
  breakeven: the median peak is only 1.21x, and a 35.5% trail from there lands
  near 0.79x.
- **All the profit is the 2x ladder.** The 66 take-initials trades netted
  +0.537 SOL, nearly all of the fleet's +0.736 SOL gross profit. 59% of positions
  never quoted above cost at all.

### What coins did after we sold

- 174 traded coins later reached 2x our entry, 72 reached 5x, 28 reached 10x,
  and 2 reached 100x+ (one 953x, 32 hours after our exit). Crosshair accounts for
  most of them.
- But holding everything to today would have been far worse: only 4 of 1,330
  coins trade above our entry now, and holding turns 9.61 SOL staked into 5.69
  (-41%). The exits are net-positive versus holding; the runners simply are not
  distinguishable at entry with any signal we have.

### Costs

| Size | Curve fees + tx | Unclosed rent | Breakeven (rent closed) | Breakeven (rent lost) |
|---|---|---|---|---|
| 0.002 SOL | 2.47% + 0.51% | 75.7% | ~3.0% | ~79% |
| 0.01 SOL | 2.47% + 0.10% | 15.1% | ~2.6% | ~18% |
| 0.05 SOL | 2.47% + 0.02% (+0.1% impact) | 3.0% | ~2.6% | ~5.7% |

The pump.fun curve fee round trip was measured on-chain at exactly 2.469%.
Quote-based PnL matches on-chain wallet deltas within tx fees for full exits.

### Failed entries

2,863 failed attempts, none of which signed a transaction: SIM_FAILED 1,414
(1,364 on Boost Ride, so 94% of that arm's attempts fail), CoinGraduatedError
897 (894 on Crosshair), firewall round-trip blocks 351, landing failures ~160.
They cost missed trades, not SOL.

## What the market looks like

Measured over 95,954 recent launches (2026-09-28 to 09-30), with self-graduation
schemes removed (a dev buys ~85 SOL in the create tx and one buyer prints a fake
all-time high; they were 37% of historical graduations).

| Peak market cap | Share of launches |
|---|---|
| >= $10k | 12.0% |
| >= $100k | 0.68% |
| >= $1M | 0.018% (about 6 a day) |

From a perfect fill at the first $10k crossing: 35.5% reach 2x, 5.7% reach 10x,
0.15% reach 100x, roughly 0.01% reach 1000x.

**Drawdown before the peak is what kills trailing stops.** A future 10x runner
draws down a median 37% (1-minute closes) before it peaks; 71% draw down 20%+
and 45% draw down 40%+. Future 30x runners draw down a median 50%. The fleet's
20-25% trails shake out roughly 7 in 10 eventual 10x runners. Median time from
$10k to peak is 12 minutes for a 10x and 37 minutes for a 30x; the largest ran
4 to 41 hours, well past every arm's max hold.

**Signals rank well and arrive too late.** Net buy volume >= 40 SOL in the first
90 s, smart-money presence, and an Oracle score of 70+ all lift the chance of a
$100k+ coin 19x to 80x. But 91% of first $10k crossings happen before those
90-second features exist, and buying the coins they flag loses 15% to 58% per
trade because the move is already priced in. The Oracle is ordinal but
overconfident: its 86+ band realizes 22% "peaked 2x after scoring". Signals that
reliably predict **losers** (fewer than 2 unique buyers, the dev sold within
90 s, serial creators, a Twitter link that is a status URL) are useful as skip
filters.

**The only positive results in any simulation required a fill at the trigger
price:** entering at graduation market cap with a perfect fill, a half-at-2x
ladder plus a 30% trail returned +2% to +6% at 0.05-0.25 SOL. A one-minute delay
turns the same policy to -15% to -20%. Edge here is fill speed, not coin
selection.

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
