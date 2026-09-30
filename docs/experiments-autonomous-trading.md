# Experiment: can autonomous agents trade new coins at a profit?

Published 2026-09-30. Status: running. Spend so far: $63.87 (0.5402 SOL of realized losses). Live scoreboard: [/sniper/experiments](https://three.ws/sniper/experiments). Index of every experiment: [/experiments](https://three.ws/experiments).

This is the standard write-up for the trading experiment. The full rule set, the exit math and how to run it live in [the experiment spec](trading-experiment.md); the long-form account of the first 90 trades, with charts, is the [blog post](https://three.ws/blog/autonomous-trading-experiment). This page adds the sections those two do not carry: the spend, the whole-history result measured on one date, and what it changed.

## The question

Give AI agents their own Solana wallets and real SOL, let each one trade newly launched coins under a written strategy (fixed rules, or a language model judging each coin), and record why every buy and sell happened. **After fees and bad fills, do they make money, and which strategies come closest?**

## Method

- **Window:** every real mainnet trade from the first fill on 2026-07-03 to 2026-09-30 00:00 UTC (end exclusive, pinned so the queries re-run to the same answer).
- **Tables:** `agent_sniper_strategies` (each armed strategy, its rules and whether it is judged by rules or a model), `agent_sniper_positions` (each trade: entry, exit, realized P&L), `sniper_llm_verdicts` (every model judgment, bought or not).
- **Real fills only:** a position counts when it has an on-chain buy signature. Paper trades from simulate mode carry the `SIMULATED` sentinel and are reported on their own line, never mixed in.
- **Sample:** 28 strategies on 28 agents in 4 experiment groups, 1,296 closed trades. No sampling.
- **Tools:** the sniper worker (`workers/agent-sniper/`), the arm API (`api/sniper/strategy.js`), and SELECT-only queries run against the production database on 2026-09-30. Every query is in the appendix.

## Spend

**0.5402 SOL of net realized losses, $63.87** valued at the live SOL price when this was measured ($118.23 at 2026-09-30 08:25 UTC, read through the platform's own price helper). That is the money the experiment has cost so far. It is valued at one price on one date, not at the price of each trade.

Two costs are listed but not added, because we could not attribute them honestly:

- **Tips:** positions record 0.001035 SOL of priority tips in `tip_lamports`. We have not verified whether realized P&L already nets them, so they are shown, not summed.
- **Model calls:** the judges produced 357,988 mainnet verdicts since 2026-07-21. The verdict table carries no cost column, so the language-model cost of the experiment is not measured.

## Result

| Whole history, mainnet, real fills | Value |
|---|---|
| Closed trades | 1,296 |
| Winners (realized P&L above zero) | 212 (16.4%) |
| SOL deployed across closed trades | 9.1444 SOL |
| Net realized P&L | -0.5402 SOL (-5.91% of deployed) |
| Open positions on 2026-09-30 | 0 |
| Paper (simulate-mode) trades closed | 15, 1 winner |

**By how the strategy decides:**

| Decision mode | Closed | Winners | Net realized | Of deployed |
|---|---|---|---|---|
| Fixed rules | 1,220 | 196 (16.1%) | -0.5196 SOL | -6.17% |
| Language-model judge | 76 | 16 (21.1%) | -0.0206 SOL | -2.86% |

**How trades ended:**

| Exit reason | Trades | Net realized |
|---|---|---|
| Liquidity decay (nobody trading the coin) | 468 | -0.1257 SOL |
| Stop-loss | 318 | -0.6752 SOL |
| Trailing stop | 297 | -0.2304 SOL |
| Timeout | 140 | -0.0602 SOL |
| Take-profit | 67 | +0.5512 SOL |
| Error | 6 | 0 SOL |

**Before and after the 2026-08-09 retune:**

| Period (by trade open) | Closed | Winners | Net realized | Of deployed |
|---|---|---|---|---|
| Before 2026-08-09 | 241 | 80 (33.2%) | -0.0594 SOL | -1.13% |
| From 2026-08-09 | 1,055 | 132 (12.5%) | -0.4808 SOL | -12.37% |

**The take-initials ladder** (sell enough at 2x to recover the stake, keep the rest): the 63 trades where it fired made +0.5298 SOL. The other 1,233 lost 1.0700 SOL.

**By month:**

| Month | Closed | Winners | Net realized |
|---|---|---|---|
| 2026-07 | 241 | 80 | -0.0594 SOL |
| 2026-08 | 437 | 39 | -0.2842 SOL |
| 2026-09 | 618 | 93 | -0.1966 SOL |

What the numbers say: the fleet as a whole loses money. The only exits that make money are the take-profit and take-initials paths, and they are rare. The language-model arms lost less per SOL deployed than the rule arms, on a sample one sixteenth the size, which is not yet enough to call. The judges said buy on 16,860 of 357,988 verdicts (4.7%).

## What we got wrong

- **The retune made the numbers worse, not better.** The 2026-08-09 retune (section "The 2026-08-09 retune" of [the spec](trading-experiment.md)) rewrote the strategy table around what the first trades said. Measured by trade open date, the win rate after it fell from 33.2% to 12.5%, and the loss per SOL deployed grew from 1.13% to 12.37%. The fleet also traded far more after it (241 closed trades before, 1,055 after). Either way, it did not do what it was for.
- **Stops do not cap the downside.** Stop-loss exits alone lost 0.6752 SOL, more than the whole fleet's net loss. The spec already records why: on a thin bonding curve a coin can gap straight through a stop before it fires.
- **The trailing stop, meant to lock in gains, lost money in aggregate** (297 trades, -0.2304 SOL). We have not yet compared each trade's peak value with its exit value, which is the measurement that would say why.
- **We measured win rate first.** Early reporting led with win rate. It is the wrong headline: the rule arms won 16.1%, and the only exit groups that made money are the 67 take-profits (+0.5512 SOL) and the 63 ladder recoveries (+0.5298 SOL), which can overlap. The blog post makes the same case in its section "Win rate is a vanity metric".
- **We cannot state the full cost.** The model calls behind 357,988 verdicts were never priced per verdict, so "spend" above is trading losses only.

## What we changed because of it

Changed already, each documented in [the spec](trading-experiment.md):

- **The take-initials ladder is enforced on every enabled arm**, because it is the one exit pattern that made money, and the fleet never sells the whole of a winning position.
- **A liquidity-decay exit** closes an underwater position whose price has frozen, instead of letting it sit until the timeout. It now ends more trades than any other exit (468).
- **A confidence ceiling and strict-model mode for the model arms**, so an over-confident verdict or a fallback model's answer is recorded but not funded.
- **A row-count watchdog** (`/api/cron/sniper-loops-health`) that pages when any learning loop stops writing rows, and a `stall` field on the live scoreboard naming why an arm is not trading.

Will change next, and re-measure with the same queries:

- **Size entries as if every coin can go to zero**, since stops do not hold. The next measurement should show stop-loss losses shrinking as a share of deployed SOL.
- **Price the model calls**, so the spend line can include the judges and the model arms can be compared on cost as well as P&L.
- **Judge the retune by the numbers above**, not by the reasoning behind it: if the post-retune loss rate does not fall in the next window, roll the strategy table back toward the pre-retune shape.

## Appendix: the queries

Every figure above comes from one of these SELECT statements, run against the production database on 2026-09-30, with fixed end timestamps so they re-run to the same answer. The SOL price is the one exception: it was read once, live, through `solPriceUsd()` in `api/_lib/sol-price.js` at 2026-09-30 08:25 UTC and returned 118.23.

**Strategies** (28 strategies, 28 agents, 4 experiment groups; 11 enabled on 2026-09-30; first armed 2026-06-18):

```sql
select count(*) as strategies, count(*) filter (where enabled) as enabled_now,
       count(distinct experiment_group) as groups, count(distinct agent_id) as agents,
       min(created_at) as first_armed
from agent_sniper_strategies
where network = 'mainnet' and created_at < '2026-09-30T00:00:00Z';
```

**Whole-history result** (1,296 closed; 212 winners; 0 open; -540,179,418 lamports realized on 9,144,352,384 deployed; 1,035,000 lamports of tips; first fill 2026-07-03):

```sql
select count(*) filter (where status = 'closed') as closed,
       count(*) filter (where status = 'closed' and realized_pnl_lamports > 0) as wins,
       count(*) filter (where status = 'open') as open_now,
       coalesce(sum(realized_pnl_lamports) filter (where status = 'closed'), 0) as realized_pnl_lamports,
       coalesce(sum(entry_quote_lamports) filter (where status = 'closed'), 0) as deployed_lamports,
       coalesce(sum(tip_lamports), 0) as tips_lamports,
       min(opened_at) as first_trade, max(closed_at) as last_close
from agent_sniper_positions
where network = 'mainnet' and buy_sig is not null and buy_sig <> 'SIMULATED'
  and opened_at < '2026-09-30T00:00:00Z';
```

**By decision mode** (the rules and model table):

```sql
select coalesce(s.decision_mode, 'rules') as mode,
       count(*) filter (where p.status = 'closed') as closed,
       count(*) filter (where p.status = 'closed' and p.realized_pnl_lamports > 0) as wins,
       coalesce(sum(p.realized_pnl_lamports) filter (where p.status = 'closed'), 0) as realized_pnl_lamports,
       coalesce(sum(p.entry_quote_lamports) filter (where p.status = 'closed'), 0) as deployed_lamports
from agent_sniper_positions p
join agent_sniper_strategies s on s.id = p.strategy_id
where p.network = 'mainnet' and p.buy_sig is not null and p.buy_sig <> 'SIMULATED'
  and p.opened_at < '2026-09-30T00:00:00Z'
group by 1 order by 1;
```

**By exit reason** (the exit table):

```sql
select coalesce(exit_reason, 'none') as exit_reason, count(*) as closed,
       coalesce(sum(realized_pnl_lamports), 0) as realized_pnl_lamports
from agent_sniper_positions
where network = 'mainnet' and status = 'closed' and buy_sig is not null and buy_sig <> 'SIMULATED'
  and opened_at < '2026-09-30T00:00:00Z'
group by 1 order by closed desc;
```

**Paper trades** (15 closed, 1 winner):

```sql
select count(*) filter (where status = 'closed') as paper_closed,
       count(*) filter (where status = 'closed' and realized_pnl_lamports > 0) as paper_wins
from agent_sniper_positions
where network = 'mainnet' and buy_sig = 'SIMULATED' and opened_at < '2026-09-30T00:00:00Z';
```

**By month** (the monthly table):

```sql
select to_char(date_trunc('month', opened_at at time zone 'UTC'), 'YYYY-MM') as month,
       count(*) filter (where status = 'closed') as closed,
       count(*) filter (where status = 'closed' and realized_pnl_lamports > 0) as wins,
       coalesce(sum(realized_pnl_lamports) filter (where status = 'closed'), 0) as realized_pnl_lamports
from agent_sniper_positions
where network = 'mainnet' and buy_sig is not null and buy_sig <> 'SIMULATED'
  and opened_at < '2026-09-30T00:00:00Z'
group by 1 order by 1;
```

**Model verdicts** (357,988 verdicts, 16,860 buys, first on 2026-07-21):

```sql
select count(*) as verdicts, count(*) filter (where buy) as said_buy, min(created_at) as first_verdict
from sniper_llm_verdicts
where network = 'mainnet' and created_at < '2026-09-30T00:00:00Z';
```

**Before and after the retune** (the retune table):

```sql
select case when opened_at < '2026-08-09T00:00:00Z' then 'before 2026-08-09' else 'from 2026-08-09' end as period,
       count(*) filter (where status = 'closed') as closed,
       count(*) filter (where status = 'closed' and realized_pnl_lamports > 0) as wins,
       coalesce(sum(realized_pnl_lamports) filter (where status = 'closed'), 0) as realized_pnl_lamports,
       coalesce(sum(entry_quote_lamports) filter (where status = 'closed'), 0) as deployed_lamports
from agent_sniper_positions
where network = 'mainnet' and buy_sig is not null and buy_sig <> 'SIMULATED'
  and opened_at < '2026-09-30T00:00:00Z'
group by 1 order by 1;
```

**The take-initials ladder** (63 trades +529,834,054 lamports; 1,233 trades -1,070,013,472 lamports):

```sql
select coalesce(initials_recovered, false) as initials_recovered,
       count(*) filter (where status = 'closed') as closed,
       coalesce(sum(realized_pnl_lamports) filter (where status = 'closed'), 0) as realized_pnl_lamports
from agent_sniper_positions
where network = 'mainnet' and buy_sig is not null and buy_sig <> 'SIMULATED'
  and opened_at < '2026-09-30T00:00:00Z'
group by 1 order by 1;
```

Derived figures: 1 SOL = 1,000,000,000 lamports. 212 / 1,296 = 16.4%; -0.5402 / 9.1444 = -5.91%; 196 / 1,220 = 16.1%; -0.5196 / 8.4249 = -6.17%; 16 / 76 = 21.1%; -0.0206 / 0.7195 = -2.86%; 80 / 241 = 33.2%; -0.0594 / 5.2567 = -1.13%; 132 / 1,055 = 12.5%; -0.4808 / 3.8876 = -12.37%; 16,860 / 357,988 = 4.7%; 0.540179418 x 118.23 = $63.87.
