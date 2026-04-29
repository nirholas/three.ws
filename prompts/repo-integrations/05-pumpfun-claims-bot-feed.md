# 05 — pumpfun-claims-bot first-time-claim feed

**Branch:** `feat/first-claim-feed`
**Source repo:** https://github.com/nirholas/pumpfun-claims-bot
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

The pumpfun-claims-bot repo specifically tracks **first-time creator fee claims** — a stronger signal than "any claim" because it correlates with the creator finally taking money off the table. Surfacing this as an HTTP feed + agent skill gives the 3D agent a clean trigger for "this creator just cashed out for the first time" reactions.

## Read these first

| File | Why |
| :--- | :--- |
| [src/agent-skills-pumpfun-watch.js](../../src/agent-skills-pumpfun-watch.js) | Watch skill conventions. |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | One-shot skill conventions. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP tool conventions. |
| https://github.com/nirholas/pumpfun-claims-bot | Reference. Read README + main source — the dedupe logic for "first claim per creator" is the core value. |

## Build this

1. Add `src/pump/first-claims.js` exporting:
    ```js
    export async function fetchFirstClaims({ sinceTs, limit = 50 })
    // Returns first-ever fee-claim events per creator, newest first, since `sinceTs`.
    // Each item: { creator, mint, signature, lamports, ts }.
    // Dedupe rule: if a creator has any prior claim before sinceTs, exclude.
    ```
2. Add `api/pump/first-claims.js` — GET endpoint wrapping the function:
    ```js
    // GET /api/pump/first-claims?sinceMinutes=60&limit=50
    // → { items: [...] }
    ```
3. Register a skill `pumpfun.firstClaims` in [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) calling `fetchFirstClaims`.
4. Register an MCP tool `pumpfun_first_claims` in [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js).
5. Add `tests/pump-first-claims.test.js` asserting the dedupe rule rejects creators with any prior claim.

## Out of scope

- Telegram delivery (that's prompt 04).
- DB-backed state — keep dedupe in-memory or against a single RPC sweep per request.
- UI changes.

## Acceptance

- [ ] `node --check` passes for new files.
- [ ] `npx vitest run tests/pump-first-claims.test.js` passes.
- [ ] Skill + MCP tool callable.
- [ ] `npx vite build` passes.

## Test plan

1. Hit `/api/pump/first-claims?sinceMinutes=240&limit=20`; confirm valid items.
2. Re-hit it within seconds; same items return (idempotent).
3. Call the agent skill; confirm a useful summary.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
