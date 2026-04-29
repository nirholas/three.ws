# 28 — MCP tool: creator history

**Branch:** `feat/mcp-creator-history`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

"Has this creator launched tokens before?" is a critical due-diligence question. A `pumpfun_creator_history` MCP tool gives the LLM that context in one call.

## Read these first

| File | Why |
| :--- | :--- |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP registration. |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Existing skill style. |
| `node_modules/@pump-fun/pump-sdk/` | SDK surface. |

## Build this

1. Register MCP tool `pumpfun_creator_history`:
    - Args: `{ creator: string, limit?: number (default 25, max 100) }`
    - Returns `{ creator, count, tokens: [{ mint, name, symbol, createdAt, graduated, marketCapUsd, peakMarketCapUsd? }] }` newest first.
2. Implement in `src/pump/creator-history.js` using existing SDKs. Reuse the same data sources the agent-token widget uses.
3. Add `tests/pump-creator-history.test.js` mocking the SDK and asserting:
    - Sort order.
    - `count` matches `tokens.length`.
    - `limit` is honored.

## Out of scope

- Wallet-to-creator linking heuristics.
- Tracking creator P&L (that's prompt 13's territory).

## Acceptance

- [ ] Tool appears in `tools/list`.
- [ ] `npx vitest run tests/pump-creator-history.test.js` passes.
- [ ] Calling against a known prolific creator returns multiple entries.
- [ ] `npx vite build` passes.

## Test plan

1. Pick a known creator wallet. Run the tool. Confirm count and recent tokens.
2. Pass `limit: 1`. Confirm one entry.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
