---
slug: sniper-experiment-judge-cost-and-exit-giveback
title: Record LLM judge cost per verdict and measure trailing-stop giveback in the sniper experiment
tier: P3
score: 35
area: sniper
sources: docs/experiments-autonomous-trading.md, docs/trading-experiment.md
---

## Why this matters

The autonomous-trading experiment asks whether agents profit on new coins, but the LLM judge's cost per verdict is not recorded (no token or cost columns in `sniper_llm_verdicts`), so net profit cannot subtract inference cost. The trailing-stop logic is also unevaluated: nobody has compared peak price to exit price to see how much gain is given back.

## Current state (measured by the reviewer on 2026-11-03)

- `sniper_llm_verdicts` (migration `20260719160000_sniper_llm_verdicts.sql`) has no cost/token columns.
- `workers/agent-sniper/exit-logic.js` `decideExit` implements the trailing stop; peak-vs-exit analysis not done.

## Step 0: re-derive the current state

```
sed -n 1,60p api/_lib/migrations/20260719160000_sniper_llm_verdicts.sql
grep -n "decideExit\|trail" workers/agent-sniper/exit-logic.js | head -20
grep -rn "sniper_llm_verdicts" workers api scripts -l
```

## Tasks

1. Test first in the worker suite (`workers/agent-sniper/` tests or `tests/sniper-judge-cost.test.js`): a verdict write stores input tokens, output tokens and computed USD cost from the provider usage fields.
2. Additive migration adding `input_tokens`, `output_tokens`, `cost_usd` to `sniper_llm_verdicts`; write them where verdicts are inserted.
3. Add a read-only script `scripts/sniper-experiment-report.mjs` that, for a pinned window, reports per-position realized PnL, judge cost, net PnL, and trailing-stop giveback (peak vs exit) using stored price samples.
4. Record results in `docs/experiments-autonomous-trading.md` and, if giveback is large, open the tuning change as a follow-up finding (do not change live exit parameters in this order).
5. Changelog and docs entries.

## Definition of done

- [ ] New tests pass; migration applied (`npm run db:status`).
- [ ] `node scripts/sniper-experiment-report.mjs --from <ts> --to <ts>` prints net PnL and giveback from real data.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Provider usage fields differ | Normalize in one helper; Vertex and Anthropic both return token counts |
| Few positions in window | Report the sample size honestly; do not pad |

## Gates

Do not change live mainnet trading parameters or fund the sniper wallet in this order; analysis only.
