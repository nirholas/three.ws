---
name: dca-planner
description: Plan a dollar-cost-averaging schedule for a Solana token - total budget, number of buys, interval, per-buy size, slippage and price-impact guards - check it against fees and the user's risk limits, and produce the exact order for the agent's orders API, previewed before anything is placed. Use when the user says DCA, "buy a little every day", "accumulate over a month", recurring buys, or asks how to spread an entry over time.
---

# DCA planner

You design a recurring-buy plan the user can read in ten seconds and the platform can execute exactly. You plan and preview. You never place the order without the user's explicit yes to the final numbers.

## Collect four things

1. **Token mint address.** Run token safety diligence first if it has not been done in this conversation; do not schedule 30 buys of a token that can be frozen.
2. **Total budget** in SOL. Check it against the user's risk rules: a DCA is still one position, and its full total counts toward the per-token concentration cap.
3. **Interval**: how often to buy. Daily and weekly are the defaults; hourly only makes sense for budgets large enough that each buy stays meaningful.
4. **Duration**: how long to keep buying.

`slices = duration / interval` (at most 1000, the orders API maximum) and `per-buy size = total / slices`.

## Sanity checks before you show a plan

- **Minimum buy size.** Under about 0.01 SOL per buy, base fees plus slippage eat a visible share of every purchase. Propose a longer interval instead.
- **Liquidity.** Each buy should be under 1% of pool liquidity (`GET https://three.ws/api/crypto/token?address=<mint>`). Otherwise the plan moves the price against itself.
- **Slippage**: 300 bps (3%) is a sane default for liquid tokens; thin pools may need more. Say what you picked and why.
- **Price-impact ceiling**: 3% per buy by default. The agent's own trade limits (`GET https://three.ws/api/agents/<agent_id>/trade/limits`: `per_trade_sol`, `daily_budget_sol`, `max_price_impact_pct`) apply to every fill as well. If `per_trade_sol` is below the per-buy size, or `daily_budget_sol` is below a day's buys, the plan will be refused at fire time. Catch that now.
- **End date**: set `expires_at` a day after the last buy so a delayed final slice still runs and the order cannot live forever.

The bundled planner does the arithmetic and the fee check, and prints the order body:

```bash
node scripts/dca-plan.mjs --mint <mint> --total-sol 3 --every 1d --for 30d
node scripts/dca-plan.mjs --mint <mint> --total-sol 3 --every 12h --for 2w --slippage-bps 500 --json
```

## Show the plan

> **Plan:** 30 buys of 0.1 SOL, one a day, 22 Sep to 21 Oct. Total 3 SOL.
> Guards: 3% slippage, 3% price-impact ceiling per buy. Stops on 23 Oct.
> Fits your limits: 3 SOL is 7.5% of a 40 SOL portfolio, under the 10% cap.

Then ask: "Place this plan on <agent name>?"

## Placing it (three.ws agent, owner only)

1. Preview. Validates the order and runs the trade firewall without placing anything:
   `POST https://three.ws/api/agents/<agent_id>/orders/preview` with the body the planner printed:
   ```json
   { "type": "dca", "side": "buy", "mint": "<mint>", "size_sol": 0.1,
     "schedule": { "interval_seconds": 86400, "slices": 30 },
     "slippage_bps": 300, "max_price_impact_pct": 3, "expires_at": "<ISO date>" }
   ```
2. Show the preview verdict. Stop if it says block.
3. Only after the user answers yes to this exact plan: `POST https://three.ws/api/agents/<agent_id>/orders` with the same body. Report the order id.
4. To stop early: `DELETE https://three.ws/api/agents/<agent_id>/orders/<order_id>`, or `POST .../orders/cancel-all`.

Sells work the same way with `"side": "sell"` and either `size_tokens` or `sell_pct` per slice.

## Rules

- DCA reduces timing risk; it does not make a bad token good. Never present it as safe.
- Never raise the budget, shorten the interval, or loosen a guard without the user asking.
- Buying moves real funds on every slice. Placing the order needs a clear yes to the token, total, per-buy size and schedule, shown together.
