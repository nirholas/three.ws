---
name: agent-spend-guards
description: Check a proposed agent trade or spend against per-trade, daily, price-impact, kill-switch and allowlist limits using @three-ws/agent-guards. Use when building or reviewing an autonomous agent that can move funds and needs hard caps before signing.
---

# Agent spend guards

`@three-ws/agent-guards` (Node 18+, zero dependencies, ESM) has two halves:

1. Local pure functions (`policy`, `guard`, `check*`) that need no network and no token.
2. A client (`guards(agentId, opts)` or `createGuards(opts)`) for the hosted three.ws policy endpoints.

Install: `npm install @three-ws/agent-guards`

## Local check (no token)

```js
import { policy, guard } from '@three-ws/agent-guards';

const p = policy({ per_trade_sol: 0.5, daily_budget_sol: 2, max_concurrent: 3 });
const d = guard({ side: 'buy', amountSol: 0.9, priceImpactPct: 2 }, p);
// d.allow === false, d.reason === 'per_trade_cap', d.message explains the fix
```

Policy keys: `per_trade_sol`, `daily_budget_sol`, `max_price_impact_pct`, `max_slippage_bps`,
`max_concurrent`, `kill_switch`, `daily_usd`, `per_tx_usd`, `withdraw_allowlist`, `frozen`.
An unset ceiling means no cap.

Transaction fields (`GuardTx`): `side` (`buy`|`sell`), `category` (`trade`|`snipe`|`x402`|`withdraw`),
`amountSol` or `amountLamports`, `priceImpactPct`, `walletLamports`, `spentLamports` (rolling 24h),
`openCount`, `usdValue`, `spentUsd`, `destination`. A guard whose input is omitted is skipped, so
supply every number you want enforced.

Reason codes: `kill_switch`, `wallet_frozen`, `per_trade_cap`, `daily_budget`, `per_tx_exceeded`,
`daily_exceeded`, `max_positions`, `price_impact`, `insufficient_sol`, `destination_not_allowed`.

Individual predicates are exported too: `checkKillSwitch`, `checkFrozen`, `checkConcurrency`,
`checkPerTradeCap`, `checkDailyBudgetLamports`, `checkSolHeadroom`, `checkPriceImpact`,
`checkPerTxUsd`, `checkDailyUsd`, `checkAllowlist`. Each returns `null` (pass) or `{reason, detail}`.

## Hosted policy (owner token required)

```js
import { guards } from '@three-ws/agent-guards';
const a = guards('agent_abc123', { token: process.env.THREE_WS_TOKEN });

await a.setTradeLimits({ per_trade_sol: 0.5, daily_budget_sol: 2 });
const decision = await a.checkTrade({ side: 'buy', mint, amount: 0.3 }); // simulates, moves no funds
if (decision.allowed) await a.trade({ side: 'buy', mint, amount: 0.3 }); // really executes
await a.setTradeLimits({ kill_switch: true }); // reject every discretionary trade
```

Other methods: `getTradeLimits()`, `getSpendLimits({network})`, `setSpendLimits(patch, {network})`.
Endpoints used: `/api/agents/:id/trade`, `/trade/quote`, `/trade/limits`, `/wallet/limits` on
`https://three.ws` (override with `baseUrl`). Env: `THREE_WS_TOKEN` (owner bearer token).

## Rules for the agent

- Run `guard()` or `checkTrade()` before every signing step. Do not call `trade()` on a blocked decision.
- `trade()` moves real funds. Show the user side, mint and amount, and wait for an explicit yes first.
- Never put the token in code or logs.
