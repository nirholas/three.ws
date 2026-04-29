# 37 — Integration tests for the pump.fun surface

**Branch:** `test/pump-integration`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

The pump.fun surface (skills + MCP tools + HTTP handlers) has unit tests scattered across files. A single integration test that calls each public surface end-to-end (against mocks) catches contract-level regressions when any one prompt above ships.

## Read these first

| File | Why |
| :--- | :--- |
| [tests/](../../tests/) | Existing tests — match style. |
| [tests/pumpfun-mcp.test.js](../../tests/pumpfun-mcp.test.js) | Closest existing test. |
| [vitest.config.js](../../vitest.config.js) | Test runner config. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | Tool list to assert against. |

## Build this

1. Add `tests/pump-surface-integration.test.js`. The test:
    - Loads the live MCP tool list.
    - For each tool, calls it with a minimal valid payload using mocks for upstream sources (RPC, SDK).
    - Asserts each tool returns a 2xx-shaped result without throwing.
    - Asserts the response shape includes the documented top-level fields.
2. The mock layer lives in `tests/_helpers/pump-mocks.js` (one new helper file). Provide:
    - `withMockedPump(fn)` — patches `globalThis.fetch` and any SDK exports the tools use.
    - Fixture data under `tests/fixtures/pump/*.json`.
3. Run separately from unit tests: tag with `describe.concurrent`, keep total runtime under 5 seconds.

## Out of scope

- Real RPC / SDK calls.
- Coverage targets.
- Editing existing unit tests.

## Acceptance

- [ ] `npx vitest run tests/pump-surface-integration.test.js` passes.
- [ ] Test exercises every MCP tool currently registered.
- [ ] Total runtime under 5s on a clean machine.
- [ ] `npx vite build` passes.

## Test plan

1. Run the test; confirm green.
2. Comment out one tool's registration; rerun; confirm the integration test fails loudly with a clear message.
3. Restore.

## Reporting

- Shipped: …
- Skipped: …
- Tools that could not be tested without real RPC (with reason): …
- Unrelated bugs noticed: …
