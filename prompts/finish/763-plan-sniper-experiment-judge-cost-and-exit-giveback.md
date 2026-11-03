# Record LLM judge cost per verdict and measure trailing-stop giveback in the sniper experiment

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/763-plan-sniper-experiment-judge-cost-and-exit-giveback.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 35 of 100 inside the tier). **Area:** sniper. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The autonomous-trading experiment asks whether agents profit on new coins, but the LLM judge's cost per verdict is not recorded (no token or cost columns in `sniper_llm_verdicts`), so net profit cannot subtract inference cost. The trailing-stop logic is also unevaluated: nobody has compared peak price to exit price to see how much gain is given back.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `sniper_llm_verdicts` (migration `20260719160000_sniper_llm_verdicts.sql`) has no cost/token columns.
- `workers/agent-sniper/exit-logic.js` `decideExit` implements the trailing stop; peak-vs-exit analysis not done.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
sed -n 1,60p api/_lib/migrations/20260719160000_sniper_llm_verdicts.sql
grep -n "decideExit\|trail" workers/agent-sniper/exit-logic.js | head -20
grep -rn "sniper_llm_verdicts" workers api scripts -l
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first in the worker suite (`workers/agent-sniper/` tests or `tests/sniper-judge-cost.test.js`): a verdict write stores input tokens, output tokens and computed USD cost from the provider usage fields.
2. Additive migration adding `input_tokens`, `output_tokens`, `cost_usd` to `sniper_llm_verdicts`; write them where verdicts are inserted.
3. Add a read-only script `scripts/sniper-experiment-report.mjs` that, for a pinned window, reports per-position realized PnL, judge cost, net PnL, and trailing-stop giveback (peak vs exit) using stored price samples.
4. Record results in `docs/experiments-autonomous-trading.md` and, if giveback is large, open the tuning change as a follow-up finding (do not change live exit parameters in this order).
5. Changelog and docs entries.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] New tests pass; migration applied (`npm run db:status`).
- [ ] `node scripts/sniper-experiment-report.mjs --from <ts> --to <ts>` prints net PnL and giveback from real data.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Provider usage fields differ | Normalize in one helper; Vertex and Anthropic both return token counts |
| Few positions in window | Report the sample size honestly; do not pad |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Do not change live mainnet trading parameters or fund the sniper wallet in this order; analysis only.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/763-plan-sniper-experiment-judge-cost-and-exit-giveback.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `763-plan-sniper-experiment-judge-cost-and-exit-giveback.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/experiments-autonomous-trading.md` (whole file)

~~~~markdown
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
~~~~

### `docs/trading-experiment.md` (whole file)

~~~~markdown
# The 10 SOL trading experiment

Give one autonomous agent a real budget (≈10 SOL), let it trade newer pump.fun
launches under a disciplined risk policy, and **learn what works** from a decision
journal. This doc is the full spec: the rules, the math, how to fund it from the
UI, how to run it safely (simulate first), the kill switches, and how to read the
journal.

Everything here runs on the existing sniper worker (`workers/agent-sniper/`) and
the arm API (`api/sniper/strategy.js`). Nothing new moves money on its own.

## The thesis

Get in early on newer projects, but never make the classic mistake of dumping the
whole bag on the first pump. Instead: recover your initial stake once the trade
works (~2×), then hold the rest as a "moon bag" and let it run, protected by a
trailing stop. Cap the downside with a hard stop-loss. Record *why* every buy and
sell happened so the strategy can actually be improved.

## The rules (and the math)

| Rule | Setting | Why |
|---|---|---|
| **Entry universe** | market cap **$10k-$100k** | newer / newer-established projects, not dust and not already-run |
| **No Mayhem** | pump.fun Mayhem tokens are always skipped | owner rule - higher-fee, buyback-less mode; enforced in the worker (see below) |
| **Quality filters** | socials required, skip serial launchers (>10 launches) | cheap signal filters |
| **Position size** | ~2.5% of budget per trade (0.25 SOL at 10 SOL), 20%/day cap | survive a losing streak |
| **Take initials** | at **2× entry**, sell enough to recover the cost basis | de-risk to "house money" without selling the whole position |
| **Moon bag floor** | always keep **≥15%** of the position | a full exit on the way up is impossible by construction |
| **Let it run** | remainder rides on a **25% trailing stop** | capture the upside a too-early full sell would miss |
| **Hard stop-loss** | **35%** below entry, always | the non-negotiable downside cap; stop-loss wins every conflict |
| **Time stop** | 24h | don't hold a dead position forever |

### Take-initials math (`workers/agent-sniper/exit-logic.js` → `decideLadderedExit`)

When a position first reaches `initials_out_multiple`× entry, sell the fraction
that returns the cost basis:

```
sellFraction = min( entry / current_value , 1 − moonbag_floor )
```

- At **2×**: `entry / (2·entry) = 0.5` → sell half, keep half. You've recovered
  your whole stake and still hold 50% for free.
- At **5×**: `0.2` → sell 20%, keep 80%.
- The `1 − moonbag_floor` cap guarantees the sell is **never** the whole bag
  (default floor 15%, so the sell never exceeds 85%).

After the take-initials leg, the position stays **open** with the moon bag, its
trailing-stop high-water is reset to the remaining value (so the pre-sale peak
doesn't instantly trip the trailing stop), and the ladder is marked recovered so
it fires exactly once.

Priority order (stop-loss always wins): `stop_loss → signal_flip → trailing_stop
→ take_initials → take_profit(ceiling) → timeout`.

## We never sell 100% of a winner

This is fleet policy, not a per-strategy option, and it applies whether or not
the take-initials ladder above ever fired.

**Once a position's cost basis is back, the remainder is free.** A free bag is
worth zero at worst and uncapped at best. Selling that last slice to bank a few
thousandths of a SOL trades away every possible outcome above it for a rounding
error. So a terminal exit that is **in profit** sells down to the moon-bag floor
(`moonbag_min_pct`, default 15%) and the retained tokens ride indefinitely.

| Situation | What happens |
|---|---|
| Trailing stop / take-profit / timeout, **in profit** | Sell enough to return the stake (or bank down to the floor if the stake is already home). The rest rides. |
| Any terminal exit **after** initials were recovered | Sell down to the floor. Never to zero: none of it is our money any more. |
| Stop-loss with the stake **still at risk** | **Full exit.** Nothing is free yet, and the hard downside cap is the one rule nothing overrides. |
| Timeout or signal-flip **underwater**, initials never recovered | **Full exit**, same reason. |
| Kill switch | **Full exit**, always. An owner pulling the switch means out. |

Worked example, the case the rule exists for: an arm enters at 1 SOL, the price
runs to 1.4x but never reaches the 2x ladder band, then the trailing stop trips.
The old behavior sold 100% of the bag to realize about +0.0028 SOL. The rule now
sells `1/1.4 = 71%` (exactly the stake) and keeps 29% riding at zero cost basis.

**A held bag does not block the arm.** The position still books `status='closed'`
when this happens, so its realized P&L lands in every existing report unchanged
and its `max_concurrent_positions` slot is released immediately. Only the tokens
stay behind, recorded on the position row (`moonbag_base_amount`,
`moonbag_entry_lamports`) and surfaced on
[/sniper/experiments](https://three.ws/sniper/experiments).

Because loss exits still sell out completely, rugs close fully and only *winners*
leave a bag behind. Every full exit now also closes the coin's token account, so
its rent (about 0.0015-0.002 SOL) returns to the wallet; only a retained bag keeps
its account open. Before 2026-10-01 no exit closed the account, and the sniper
wallets had accumulated more than 2 SOL of stranded rent (see the
[fleet review](ops/sniper-fleet-review-2026-10-01.md) and
`npm run sniper:reclaim-rent`).

Set `moonbag_always = false` on a strategy to opt a single arm out. The column
defaults to true and a null is read as true, so every existing strategy has the
rule without a backfill.

The proactive 2x ladder is the **fleet default** (owner rule, 2026-07-25): every
strategy is born with `initials_out_multiple = 2`, so the first time a position
doubles, the initial stake comes off the table and the remainder rides. Setting
the field to an explicit null through the arm API opts a single arm back into
the classic single-shot exit; even then it never fully exits a winner, because
the fleet-wide moon-bag rule below covers that independently.

The multiple itself stays tunable. A human sets it directly (this script, or the
arm API), **or** an arm earns the right to have it tuned: once the autonomy
engine places an arm at `trusted` or above and its winners demonstrably run past
its average exit, the optimizer adjusts the multiple by itself within its bounds
and records why. See
[Earned autonomy](./sniper-autonomy.md). A losing arm cannot reach the field at
all, so the ladder is only ever switched on for a strategy whose record shows it
actually catches runners.

## The post-audit fixes (from the published fleet postmortem)

The [published audit](https://three.ws/blog/autonomous-trading-experiment) of the
fleet's first 90 real trades produced three findings that are now code:

**Overconfidence ceiling** (`llm_max_confidence`). The audit's calibration table
showed judge verdicts in the 0.7 confidence band performed best while 0.9+
verdicts went winless. Each LLM arm can now carry a confidence CEILING next to
its floor: a buy verdict at or above it is recorded for calibration but never
funded. The experiment arms run floor 0.65, ceiling 0.9. Gate:
`llmVerdictGate` in [workers/agent-sniper/llm-judge.js](../workers/agent-sniper/llm-judge.js).

**Named-model strictness** (`llm_strict_model`). During the audit window the LLM
failover chain answered most named-model calls, so "Grok vs Claude" was really
"fallback vs fallback". A strict arm now refuses to trade on any verdict whose
answering model was a fallback (`fallback:*` tag): the verdict still lands in the
judgment ledger, but the arm pauses rather than pollutes its own experiment. The
grok and claude arms are strict; the auto-router arm is not (a fallback IS its
router pick).

**Liquidity-decay exit** (`liquidity_decay`). A bonding-curve quote only moves
when someone trades, so a position whose re-quoted value is exactly frozen sweep
after sweep is a coin nobody is trading. The audit found those squatting on
concurrency slots until the 30-minute timeout. Now an underwater position whose
value has not moved at all for `SNIPER_LIQUIDITY_DECAY_S` (default 300s) exits
early with reason `liquidity_decay` and frees the slot. The clock never runs in
profit (quiet winners belong to the trailing stop and the moon-bag rule), resets
on any trade, and a house-money position keeps its moon-bag floor even here.

**Row-count watchdog** (`/api/cron/sniper-loops-health`). The audit's worst
operational finding: two learning loops ran dead for two days behind green
health checks. An hourly cron now asks each autonomous loop (weight training,
outcome labeling, LLM judging, optimizer, evolution, Oracle scoring) the one
question that cannot lie, "when did you last write a row?", and pages the ops
channel when any answer exceeds that loop's cadence-derived limit. A loop with
no rows at all is the worst finding, not an exemption. Policy is pure and
tested: [api/_lib/sniper-loops-health.js](../api/_lib/sniper-loops-health.js).

## The 2026-08-09 retune (what 254 closed trades actually said)

A full autopsy of every closed mainnet trade (254 closes, 31.9% win rate, net
-0.159 SOL) reduced the fleet's whole history to five findings, and the strategy
table was rewritten to match them:

1. **Exits were the leak, not entries.** 132 of 254 trades were green at some
   point; peak unrealized gains summed to +0.93 SOL against -0.16 realized. 51
   trades went green and still closed red. The entry pickers found the upside;
   the exit policy gave it back.
2. **Stop-losses do not cap downside on this venue.** The five worst trades all
   had a 15% stop set and still closed -84% to -99.9%: a rug gaps through the
   stop before it can fire, and the entry-time firewall sim passes because the
   pool is honest until it isn't. Size every entry as if it can go to zero.
3. **The one net-positive pattern was the take-initials ladder.** The 5 trades
   that recovered initials at 2x: +0.41 SOL realized plus a moon bag still held.
   The other 249: -0.57 SOL. `initials_out_multiple=2` + `moonbag_always` is now
   enforced on every enabled arm instead of being an accident.
4. **Hold-time has a sweet spot.** Sub-400s scalps lost 0.36 SOL across 153
   trades even at a 49% win rate; the 10-15 minute band made +0.37 SOL on 5;
   everything past an hour went 0-for-20. Scalp arms were stretched into the
   band, and the timeout is treated as a failure mode, not an exit.
5. **A capped-upside/uncapped-downside arm loses even when it wins.** The
   graduation-ride arm won 63% of 90 trades and still lost money with TP 20 /
   SL 15 against occasional -99% rugs. Reward must be a multiple of risk
   everywhere: no arm keeps a TP below 2x its SL, and no *ladderless* arm trades
   with a null TP (that arm went 0-for-24). A null TP is still correct on a
   ladder arm, where the ladder takes the stake back at 2x and the trailing stop
   governs the moon bag, which is why the setup script below leaves
   `take_profit_pct` null. The failure was an uncapped bag with nothing at all
   scheduled to take profit, not the absence of a ceiling as such.

The applied changes: six lifetime-negative `new_mint` spray arms disabled (that
trigger went 4-for-64, -0.17 SOL, worst in the fleet), TP set on all 14 arms
that had none, the graduation-ride arm retuned to TP 100 / hold 900s / size
matched to the auto-funder's top-up, the tightest LLM arm widened to TP 60, and
the ladder policy enforced fleet-wide. The oracle-crossing arm, the only
strategy with a real lifetime profit (+0.17 SOL on 8 selective trades, wide TP,
1-hour hold), was deliberately left untouched: the rebuilt fleet copies its
shape rather than diluting it.

## Why an arm shows zero trades (the silent-death class)

A sniper arm can be enabled, funded, and evaluating every launch that crosses the
feed while one of its own knobs makes an entry arithmetically impossible. That
failure is silent by construction: a skipped evaluation writes no position row,
so the board shows `0` with no reason and an arm can sit dead for a week without
anything looking broken. Four arms did exactly that before this was measured.

Every armed strategy on [`/sniper/experiments`](https://three.ws/sniper/experiments)
now carries a `stall` field naming the condition. The diagnosis is a fact about
the configuration, not a guess: each code is a rule the executor really enforces,
evaluated against the same numbers. Policy is pure and tested:
[api/_lib/sniper-stall.js](../api/_lib/sniper-stall.js).

| Code | What it means | Fix |
| --- | --- | --- |
| `wallet_dry` | Balance is under `MIN_OPERATIONAL_WALLET_SOL` (0.012), so the arm cannot even pay for the firewall's simulated round-trip, let alone the buy. | Fund the wallet. |
| `mcap_band_unreachable` | The arm uses a create-event trigger (`new_mint`) with a market-cap floor above what a launch is worth at creation. Sampled live: 40 of 40 fresh pump.fun mints priced $0.1k-$5.8k, median $2.1k, so a $10k floor can never clear. | Move to `intel_confirmed` / `oracle_crossing`, which score a coin *after* it has traded into the band, or lower the floor. |
| `mcap_band_tight` | Floor is above the typical launch price but under $5k: reachable, but only for the small minority of launches that open unusually high. Non-blocking. | Widen the band or accept the low fill rate. |
| `strict_model_offline` | A `llm_strict_model` arm whose named model answered none of its recent verdicts: the failover chain answered for it, and a strict arm refuses to trade on a fallback's judgment. | Restore that model's route (provider key/credits). The worker also pages the ops channel hourly per model. |
| `size_over_budget` | Configured per-trade size exceeds the arm's whole daily budget. Non-blocking since entries now clamp down to the day's remainder. | Let the optimizer converge, or set the two knobs consistently. |
| `kill_switch` / `disabled` | Switched off. | Re-arm. |
| `no_qualifying_launch` | Config is reachable; nothing has met the entry conditions in the window. Non-blocking. | Nothing to fix. |

Two arithmetic deadlocks that produced those codes are now impossible:

**Size can no longer exceed budget.** `checkDailyBudgetLamports` blocks when
`spent + size > budget`, so an arm whose configured size drifted above its own
daily budget failed that test on every evaluation, even at zero spend on a fresh
day. The optimizer owns `per_trade_lamports` and the evolution loop owns
`daily_budget_lamports`, and neither read the other. Two fixes: the optimizer
never proposes a size above the arm's own daily budget, and the executor clamps an
oversized entry down to the day's remainder instead of sitting out (the cap still
holds exactly, and a smaller trade only lowers risk).

**A thin wallet no longer reads as a honeypot.** The firewall proves sellability
by simulating a real buy→sell round-trip *from the agent's own wallet*. When the
wallet could not fund that simulation, the revert was read as "you cannot sell" - a fatal honeypot verdict on an ordinary bonding-curve launch, where the sell path
*is* the curve program and a trap is structurally impossible. One underfunded arm
produced **336 consecutive false honeypot verdicts in 2.5 hours**. The probe now
shrinks to a size the payer can actually simulate (sellability is a property of
the coin, not of trade size), and a funding-shaped revert with no attributable
instruction is classified as an underfunded buy leg rather than a trapped exit. A
wallet that cannot fund even a minimum probe returns `probe_unaffordable`, which
is still fail-closed: unproven is never treated as safe.

### No-Mayhem enforcement (`workers/agent-sniper/mayhem-gate.js`)

`isMayhemMode` lives on the pump.fun bonding curve, not the new-mint firehose, so
it's read from the curve (one cached read per mint) and checked as **gate 0** in
`executeBuy` (before any throttle, wallet decrypt, or position row) so it covers
**every** trigger path (new_mint, intel, alpha, first_claim, radar, swarm). On by
default (`SNIPER_MAYHEM_FILTER=0` disables). A Mayhem mint is skipped with reason
`mayhem_excluded`. The gate also fails closed by default: a curve that still can't
be read after the RPC-chain retries is skipped with reason `mayhem_unknown`, and
`SNIPER_MAYHEM_STRICT=0` restores allow-on-unknown.

## Funding it from the UI

The agent trades from its **own** custodial Solana wallet - funded by you, never
auto-funded from a platform master (`auto_fund_enabled` stays **false**).

1. Open the agent's wallet hub: **`/agent/<agentId>/wallet#deposit`**.
2. Send ~10 SOL from your own wallet (Phantom/Solflare/Backpack) to the shown
   address, or scan the Solana-Pay QR. The tab shows the balance land live.
3. The arm screen (`/arm`) shows the funded balance + runway so you can confirm
   the 10 SOL arrived before enabling.

## Running it

### 1. Arm the strategy

```bash
node scripts/trading-experiment-setup.mjs --agent <agentId> --user <userId> --budget-sol 10
# add --dry-run to preview the exact config without writing
```

This stages the strategy **disabled** by default (fund + review first). It sets
the full policy above and leaves auto-funding off.

### 2. Simulate first - prove it before real money

Run the worker in **simulate** mode (`SNIPER_MODE=simulate`). It scores, applies
the mcap gate, applies no-Mayhem, and computes laddered exits **without
broadcasting**. Watch the journal:

```
GET /api/sniper/journal?network=mainnet&agent_id=<agentId>
```

Confirm: a $10k-$100k non-Mayhem mint passes; a Mayhem mint is skipped; a >$100k
or <$10k mint is skipped; a position at 2× takes initials and keeps a moon bag; a
position at −35% exits on the stop.

### 3. Go live - deliberately

Set `SNIPER_MODE=live`, enable the strategy (`--enable`, or toggle from the UI).
Real SOL now moves from the agent wallet only.

### Kill switches (in escalation order)

1. `kill_switch = true` on the strategy - stop this agent's new buys (open
   positions still exit on their rules).
2. `SNIPER_GLOBAL_KILL=1` - halt all new buys across every agent.
3. Disable the strategy (`enabled = false`).

## Learning from it - the journal

Every decision is recorded in `trading_journal` with its reasoning:

- **entry** - trigger, market cap, score, size, price impact, firewall verdict.
- **take_initials** - the fraction sold, the leg PnL, "moon bag riding".
- **exit** - the reason (trailing/stop/timeout) and the leg PnL.

Read it at `GET /api/sniper/journal`. Because it captures the *why*, not just the
PnL, you can compare what actually worked - which entry conditions led to winners,
whether 2× initials was too early or too late, whether the 25% trail gave back too
much - and tune the next run. That is the whole point of the experiment.

## Files

- Risk policy config: `scripts/trading-experiment-setup.mjs`
- Laddered exit math: `workers/agent-sniper/exit-logic.js` (`decideLadderedExit`)
- Partial-sell execution: `workers/agent-sniper/executor.js` (`executeSell`)
- No-Mayhem gate: `workers/agent-sniper/mayhem-gate.js`
- Journal: `workers/agent-sniper/journal.js`, read via `api/sniper/journal.js`
- Strategy fields: `api/sniper/strategy.js`, migrations
  `20260703150000_sniper_laddered_exit.sql`, `20260703160000_trading_journal.sql`,
  `20260816070000_trading_journal_uuid_keys.sql` (the retype that made the
  journal's writes land: `agent_id` and `position_id` are both uuid)
- Funding UI: `/agent/:id/wallet` deposit tab, `/arm`

## Related

- [STRUCTURE.md](../STRUCTURE.md) - surface map
- Auto-funding is off by default platform-wide - see the sniper auto-fund consent
  gate (`agent_sniper_strategies.auto_fund_enabled`).
~~~~

