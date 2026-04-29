# 33 — x402 paywall on premium pump signals

**Branch:** `feat/x402-paid-signals`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

The project already has x402 wiring ([api/wk-x402.js](../../api/wk-x402.js)). Putting a small per-call fee on premium signal endpoints (whale alerts, smart money trades) is a clean monetization pilot — agents calling our MCP server pay for high-value data.

## Read these first

| File | Why |
| :--- | :--- |
| [api/wk-x402.js](../../api/wk-x402.js) | x402 protocol handler — read carefully. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | Where to wrap. |
| [api/payments/](../../api/payments/) | Existing payment infra. |

## Build this

1. Add `api/_lib/x402-gate.js` (if a similar helper does not already exist — search first; if found, extend it):
    ```js
    export function withX402({ priceUsd }, handler)
    // Wraps a Vercel-style handler. If x402 payment proof present and verified, calls handler.
    // Otherwise responds 402 with the x402 payment-required body.
    ```
2. Apply `withX402({ priceUsd: 0.01 })` to two MCP tools (or their data endpoints): `pumpfun_whale_alerts` and `kol_leaderboard` (only if registered; if not, gate `/api/pump/signals` and `/api/kol/trades` instead — search first to find what exists).
3. Free tier: leave `pumpfun_token_info` and `pumpfun_recent_graduations` (or equivalents) ungated. Document the split inline.
4. Add `tests/x402-gate.test.js`:
    - 402 without payment proof.
    - 200 with mocked-valid proof.

## Out of scope

- Adjusting x402 facilitator code.
- Subscription / token-gated tiers (pay-per-call only).
- UI changes.

## Acceptance

- [ ] `node --check` passes for new files.
- [ ] `npx vitest run tests/x402-gate.test.js` passes.
- [ ] Curling a gated endpoint without payment returns 402 with a valid x402 body.
- [ ] Free endpoints remain 200.
- [ ] `npx vite build` passes.

## Test plan

1. Curl `pumpfun_whale_alerts` (gated) without proof — expect 402.
2. Curl `pumpfun_token_info` (free) — expect 200.
3. With agentcash MCP in this environment, fetch a gated endpoint via agentcash bridge; expect 200 and a debited balance.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
