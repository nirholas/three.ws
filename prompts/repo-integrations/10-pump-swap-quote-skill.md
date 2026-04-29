# 10 — Pump-swap quote + simulate skill

**Branch:** `feat/pump-swap-quote-skill`
**Source repo:** https://github.com/nirholas/pump-swap-sdk
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

The project already depends on `@pump-fun/pump-swap-sdk` (see [package.json](../../package.json)). The 3D agent has trade/compose skills but no clean "what would a swap of X cost right now?" quote skill. Adding a quote-only skill (no signing, no tx send) lets the LLM answer "is now a good time?" without risk and gives the agent something safe to do during demos.

## Read these first

| File | Why |
| :--- | :--- |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Skill registration. |
| [src/agent-skills-pumpfun-compose.js](../../src/agent-skills-pumpfun-compose.js) | Existing trade-adjacent compose skills — match style. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP tool list. |
| `node_modules/@pump-fun/pump-swap-sdk/` (already installed) | API surface for quoting. |

## Build this

1. Add `src/pump/pump-swap-quote.js` exporting:
    ```js
    export async function quoteSwap({ inputMint, outputMint, amountIn, slippageBps = 100 })
    // Returns { amountOut, priceImpactBps, route, expiresAtMs } using @pump-fun/pump-swap-sdk.
    // Throws on invalid mints or unreachable RPC.
    ```
2. Register a skill `pumpfun.quoteSwap` in [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) with the same args.
3. Register an MCP tool `pumpfun_quote_swap` in [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js).
4. Add `tests/pump-swap-quote.test.js` mocking the SDK and asserting args are passed through and shape is normalized.

## Out of scope

- Actually executing the swap (signing or sending). This is read-only.
- Token-list resolution for symbols → mints. Caller passes mint addresses.
- Persisting quotes.

## Acceptance

- [ ] `node --check src/pump/pump-swap-quote.js` passes.
- [ ] `npx vitest run tests/pump-swap-quote.test.js` passes.
- [ ] Skill + MCP tool callable.
- [ ] `npx vite build` passes.

## Test plan

1. Call the skill with `inputMint = So11111111111111111111111111111111111111112` (wSOL), a known active pump.fun token mint as `outputMint`, `amountIn = 0.01 SOL` worth of lamports. Confirm a non-zero `amountOut`.
2. Pass garbage mints; confirm a clean error.
3. Call MCP tool with same args; confirm same result.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
