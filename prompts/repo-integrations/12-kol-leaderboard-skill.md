# 12 — KOL leaderboard skill + endpoint

**Branch:** `feat/kol-leaderboard`
**Source repo:** https://github.com/nirholas/kol-quest
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

A "who are the top traders right now" leaderboard is useful both as an agent skill ("show me the top 10 KOLs by 7d P&L") and as a public endpoint embedded sites can poll. kol-quest is the reference; this prompt ports the leaderboard surface only.

## Read these first

| File | Why |
| :--- | :--- |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Skill registration. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP tool registration. |
| [api/pump/](../../api/pump/) | API style. |
| https://github.com/nirholas/kol-quest | Reference: leaderboard scoring + ranking logic. |

## Build this

1. Add `src/kol/leaderboard.js` exporting:
    ```js
    export async function getLeaderboard({ window = '7d', limit = 25 })
    // window ∈ '24h' | '7d' | '30d'
    // Returns [{ wallet, pnlUsd, winRate, trades, rank }] sorted by pnlUsd desc.
    ```
2. Add `api/kol/leaderboard.js`:
    ```js
    // GET /api/kol/leaderboard?window=7d&limit=25 → { items: [...] }
    ```
3. Register skill `kol.leaderboard` in [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js).
4. Register MCP tool `kol_leaderboard` in [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js).
5. Add `tests/kol-leaderboard.test.js` asserting:
    - Sorted descending by pnlUsd.
    - `window` is validated (rejects `'1y'`).
    - `limit` capped at 100.

## Out of scope

- Database-backed history; if no upstream source available, port the kol-quest scoring against a recent on-chain window or a static seed file in `src/kol/seed.json` and document the source choice in code comments.
- UI changes.

## Acceptance

- [ ] `node --check` passes for new files.
- [ ] `npx vitest run tests/kol-leaderboard.test.js` passes.
- [ ] Skill + MCP tool callable.
- [ ] `/api/kol/leaderboard?window=7d&limit=10` returns 10 items.
- [ ] `npx vite build` passes.

## Test plan

1. Hit endpoint; confirm response.
2. Call agent skill; confirm summary.
3. Pass `window=1y`; confirm 400.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
