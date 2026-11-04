# Spec — Agent trading capability (Feature B)

Status: **implemented 2026-11-05** (phases 1 to 4; implementation notes below) · Author: three.ws · Depends on: autopilot v0.2.0 (SOL spend cap + $THREE buy-only guard)

## Why

Today an agent's autopilot can create alerts, author briefings, and send **native SOL**. It cannot trade. The realistic, high-value autonomous behavior users want is **buying and selling pump.fun coins in SOL** — sniping new launches and acting on alpha — while treating **$THREE as buy-only** (accumulate/burn, never sell). This spec adds that capability on top of the v0.2.0 foundation.

## Principles (inherited from v0.2.0)

1. **SOL is the spend currency.** Every buy is denominated in SOL and counts against the daily SOL cap (`daily_spend_sol`). Sells return SOL.
2. **$THREE is a one-way valve.** The agent may *buy* $THREE (SOL → $THREE) and *burn* it, but a **sell of $THREE (or any transfer out of $THREE) is hard-refused server-side** — the same guard `validateWalletTransfer` already enforces, extended to the swap path.
3. **Runtime mints only.** Coins to trade are supplied at runtime (mint address from discovery/intel). Never hardcode, market, or recommend a specific non-$THREE mint in source, copy, or proposals (CLAUDE.md). $THREE remains the only coin the platform promotes.
4. **Server-side enforcement.** Scope, caps, slippage bounds, and the $THREE-sell ban live in `api/_lib/autopilot.js` / a new trade guard — the MCP client cannot bypass them.

## New autopilot action kind: `trade`

Extend `AUTOPILOT_ACTION_KINDS` with `trade` and `ACTION_TYPE.trade = 'autopilot.trade.executed'`.

**Params** (validated by a new `validateTrade`):
```
{
  side: "buy" | "sell",
  mint: "<solana mint>",          // the coin to trade; "three"/$THREE allowed for side:"buy" ONLY
  amount_sol?: number,            // required for buy — SOL to spend (counts against daily cap)
  amount_tokens?: number | "all", // required for sell — token units (or all) to sell back to SOL
  max_slippage_bps?: number,      // default 100 (1%), hard ceiling e.g. 500
  reason: string
}
```

**Guards** (all server-side, deny — never partial-execute):
- `side:"sell"` with `mint === $THREE` (or the CA) → **refused** (`code: 'three_sell_forbidden'`). This is the buy-only valve.
- `side:"buy"`: `amount_sol > 0`, `spent_24h + amount_sol ≤ daily_spend_sol`, scope `trade` granted, `confirm:true` (reuse the irreversible-confirmation policy).
- `side:"sell"`: agent must hold the position; slippage within `max_slippage_bps`.
- Reuse `dailySolSpent` for buys; sells do not add to the spend tally (they return SOL).

## Execution path

Reuse existing building blocks — do **not** add a new swap implementation if one is reusable:
- Quote: `@three-ws/pumpfun-mcp` already exposes `pumpfun_quote_swap` / `quote_swap`; the backend equivalent should quote via the same Jupiter/pump.fun route.
- Buy: pattern already proven in `avatar-agent-mcp` (`pump_buy`) and the agent custodial wallet path (`recoverSolanaAgentKeypair`, `submitProtected`).
- Settle: bundle/submit via the same protected-send path used by `transferNativeSol`.
- Record: write a signed `agent_actions` row (`autopilot.trade.executed`) with provenance, mint, side, amounts, signature, realized SOL — same receipt discipline as `wallet_transfer`.

## MCP surface

Two options — **recommended: a dedicated `@three-ws/trading-mcp`** rather than overloading autopilot, because trading has its own discovery + quote + position surface:
- `quote_trade` (read) — price + expected out + slippage for a prospective buy/sell.
- `list_positions` (read) — open positions with cost basis + unrealized PnL (reuse `portfolio-mcp` data).
- `execute_trade` (write · destructive) — buy/sell in SOL; `confirm:true`; $THREE-sell refused.
- Autopilot integration: `generate_proposals` may emit `trade` proposals (grounded in `intel-mcp` smart-money / signal memories); they flow through the existing dryrun → confirm → execute → signed-receipt loop.

`portfolio-mcp`'s `send_transfer` already lazy-loads `@solana/spl-token`; the trading server should follow the same lazy-import discipline to avoid the ESM load crash.

## Discovery → decision (where alpha comes from)

Trading proposals should cite real signals, never guess:
- `intel-mcp` — smart-money score, KOL trades, signal-feed accuracy.
- `pumpfun-mcp` — new/trending/graduating tokens, bonding-curve + holder analysis.
- Alert fires (`alerts-mcp`) → a candidate `trade` proposal the owner reviews.

## Risk & limits

- **Per-trade cap** + **daily SOL cap** (existing) + **max open positions** + **slippage ceiling**.
- **Confirmation**: buys/sells are irreversible → `require_confirm` applies, like `wallet_transfer`.
- **Trust gating**: only agents at `trusted`/`autonomous` trust may auto-execute reversibly-scoped trades (sells of a held position); buys always confirm.
- **No $THREE sell, ever** — enforced at validate + execute, covered by a test mirroring the v0.2.0 `three_sell_forbidden` case.

## Phased plan

1. **Quotes + positions (read-only):** `quote_trade`, `list_positions` over live routes. No funds move. Ship + verify.
2. **Buy (SOL → coin):** `execute_trade side:"buy"`, confirm-gated, daily-cap-bounded, signed receipt.
3. **Sell (coin → SOL):** `execute_trade side:"sell"` for held positions; $THREE-sell hard-refused.
4. **Autopilot `trade` proposals:** generation from intel/signal memories → dryrun → confirm → execute.
5. **Changelog + docs** at each phase; publish `@three-ws/trading-mcp` (start 0.1.0) and bump `autopilot-mcp` when the `trade` kind lands.

## Definition of done (per phase)

Real routes (no mocks), server-side guards with tests (including the $THREE-sell refusal), confirm-gated irreversible actions, signed `agent_actions` receipts, MCP descriptions accurate, changelog entry, and `npm run test:mcp` green.

## Implementation notes (2026-11-05)

- `trade` is a first-class autopilot kind (`api/_lib/autopilot.js`: `validateTrade`, `executeTrade`, dry-run, dedupe, proposal generation). Migration `20261105030000_autopilot_trade_kind.sql` widens the kind CHECK; apply it before enabling the scope in production.
- Param names follow the existing executor contract rather than the draft above: `slippage_bps` (1 to 500, default 100) and `token_amount_raw` (base units). Selling "all" is not offered; size a sell from `list_positions`.
- Execution reuses `runAgentTrade`, so the kill switch, per-trade cap, daily budget, USD ceiling, price-impact breaker, rug firewall, SOL headroom, idempotent custody ledger and protected sender all apply. The proposal id is the idempotency key. Buys count against `daily_spend_sol`; sells do not.
- `three_sell_forbidden` is enforced at validation and again at execution. Trades never auto-execute and always need confirmation, and the real-funds agreement is checked before the CSRF token is spent.
- `@three-ws/trading-mcp` 0.1.0 ships `quote_trade`, `list_positions`, `execute_trade`. `@three-ws/autopilot-mcp` 0.3.0 adds the `trade` scope.
- Memory-grounded generation: the LLM planner may emit `trade` for a memory with explicit buy or sell intent; the offline fallback only proposes a buy from an intel or pump.fun tagged memory that states the size and mint. Alert-fire to proposal wiring is not built.
- Owner step: publishing `@three-ws/trading-mcp` to npm and the MCP registry.
