# 25 — MCP tool: whale alerts (request/response)

**Branch:** `feat/mcp-whale-alerts`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

The pump-fun MCP server currently exposes the basics. A `pumpfun_whale_alerts` tool — request/response, returns whales over a window — gives MCP clients (Claude Desktop, Cursor, LobeHub) a clean path to ask "what whales bought X in the last 30 minutes?" without needing the streaming watch skill.

## Read these first

| File | Why |
| :--- | :--- |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | Existing MCP tool registration. |
| [src/agent-skills-pumpfun-watch.js](../../src/agent-skills-pumpfun-watch.js) | Whale-detection logic patterns; reuse what exists. |
| [tests/pumpfun-mcp-tools.test.js](../../tests/pumpfun-mcp-tools.test.js) | Existing MCP tool tests — extend. |

## Build this

1. Register an MCP tool `pumpfun_whale_alerts` in [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js):
    - Args: `{ mint: string, sinceMinutes?: number (default 30, max 240), minUsd?: number (default 5000) }`
    - Returns `{ items: [{ signature, wallet, sideBuy, usd, sol, ts }] }` newest first.
2. Implement using whatever trade-history primitive `src/pump/*` already exposes; if none, add a minimal `src/pump/recent-trades.js` helper that pulls trades for `mint` since timestamp via the existing RPC client.
3. Extend [tests/pumpfun-mcp-tools.test.js](../../tests/pumpfun-mcp-tools.test.js) with cases:
    - Returns whales above threshold.
    - Filters out trades below threshold.
    - Caps `sinceMinutes` at 240.

## Out of scope

- Streaming. This is request/response.
- Persisting alerts.
- A skill version (skill version is in prompt 01; this prompt only adds the MCP path).

## Acceptance

- [ ] Tool appears in `tools/list` on the MCP endpoint.
- [ ] `npx vitest run tests/pumpfun-mcp-tools.test.js` passes.
- [ ] Calling with `sinceMinutes: 9999` is clamped, not rejected.
- [ ] `npx vite build` passes.

## Test plan

1. JSON-RPC `tools/call` for `pumpfun_whale_alerts` with a known active mint, `sinceMinutes: 60`, `minUsd: 1000`. Confirm reasonable items.
2. Same call with `minUsd: 1_000_000`. Confirm empty.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
