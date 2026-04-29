# 26 — MCP tool: recent graduations

**Branch:** `feat/mcp-recent-graduations`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

A `pumpfun_recent_graduations` MCP tool gives any MCP client a one-call summary of "what tokens just graduated to AMM?" — useful for both signal feeds and conversational agents.

## Read these first

| File | Why |
| :--- | :--- |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP registration. |
| [services/pump-graduations/](../../services/pump-graduations/) | Existing graduation source — reuse. |
| [tests/pumpfun-mcp-tools.test.js](../../tests/pumpfun-mcp-tools.test.js) | Tests to extend. |

## Build this

1. Register an MCP tool `pumpfun_recent_graduations`:
    - Args: `{ sinceMinutes?: number (default 60, max 1440), limit?: number (default 25, max 100) }`
    - Returns `{ items: [{ mint, signature, ts, marketCapUsd, name?, symbol? }] }` newest first.
2. Read from the existing graduations service. Do not poll a new source. If the service exposes a function/queue, import it directly. If it only persists to disk/DB, read from there.
3. Extend [tests/pumpfun-mcp-tools.test.js](../../tests/pumpfun-mcp-tools.test.js) asserting:
    - Sorted newest first.
    - `sinceMinutes` and `limit` both honored.
    - Graceful empty-list response when no graduations match.

## Out of scope

- Adding new graduation detection logic.
- Editing the graduations service.

## Acceptance

- [ ] Tool appears in `tools/list`.
- [ ] Tests pass.
- [ ] `npx vite build` passes.

## Test plan

1. Run a tools/call with default args; confirm reasonable items.
2. Run with `sinceMinutes: 1`; expect short list.
3. Run with `limit: 1000`; confirm clamped.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
