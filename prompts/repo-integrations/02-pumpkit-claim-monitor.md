# 02 — Pumpkit claim-monitor as agent skill

**Branch:** `feat/pumpkit-claim-monitor`
**Source repo:** https://github.com/nirholas/pumpkit
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

Pump.fun creators can claim social fees. Pumpkit's claim-monitor surfaces these events in real time. Adding it as a 3D-agent skill means a user can say "tell me when this creator claims fees" and the agent does it — useful for KOL/whale tracking and giving the avatar something timely to react to.

## Read these first

| File | Why |
| :--- | :--- |
| [src/agent-skills-pumpfun-watch.js](../../src/agent-skills-pumpfun-watch.js) | Existing watch skills — match this shape. |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Skill registration pattern. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP tool registration pattern. |
| [src/pump/agent-token-widget.js](../../src/pump/agent-token-widget.js) | Existing pump-token surface in the 3D agent. |
| https://github.com/nirholas/pumpkit (claim-monitor module) | Logic to port. Read README + claim-monitor source. |

## Build this

1. Add `src/pump/pumpkit-claims.js` exporting:
    ```js
    export async function watchClaims({ creator, sinceTs, onClaim, signal })
    // Subscribes to pump.fun fee-claim events for `creator` wallet.
    // Calls onClaim({ signature, mint, lamports, ts }) for each claim observed.
    // Aborts when AbortSignal is triggered.

    export async function listRecentClaims({ creator, limit = 20 })
    // Returns the last N claim events for the creator wallet, newest first.
    ```
2. Register a skill `pumpfun.watchClaims` in [src/agent-skills-pumpfun-watch.js](../../src/agent-skills-pumpfun-watch.js):
    - Args: `{ creator: string, durationMs?: number }` (default 5 min, max 30 min)
    - Streams claim events into chat using the existing message-emit pattern.
3. Register a skill `pumpfun.listClaims` (one-shot) in [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) with args `{ creator: string, limit?: number }`.
4. Register MCP tools `pumpfun_watch_claims` (request/response, returns batch after durationMs) and `pumpfun_list_claims` in [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js).
5. Add a vitest test `tests/pumpkit-claims.test.js` mocking the claim source and asserting both skills behave correctly.

## Out of scope

- Telegram or webhook delivery (separate prompts).
- DB persistence of claim history.
- UI changes — strictly skill + MCP tool surfaces.

## Acceptance

- [ ] `node --check src/pump/pumpkit-claims.js` passes.
- [ ] `npx vitest run tests/pumpkit-claims.test.js` passes.
- [ ] Both skills callable from the agent.
- [ ] Both MCP tools appear in `tools/list`.
- [ ] `npx vite build` passes.

## Test plan

1. `npx vitest run tests/pumpkit-claims.test.js` — green.
2. Pick a known active pump.fun creator wallet. Run the `pumpfun.listClaims` skill against it; confirm at least one historical claim returns.
3. JSON-RPC `tools/call` for `pumpfun_list_claims` against the same wallet; same expected result.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
