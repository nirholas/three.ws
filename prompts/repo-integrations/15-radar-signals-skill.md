# 15 — gmgn radar-signals agent skill

**Branch:** `feat/radar-signals-skill`
**Source repo:** https://github.com/nirholas/scrape-smart-wallets
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

scrape-smart-wallets surfaces gmgn "radar" signals — early-detection patterns on tokens. Wrapping these as an agent skill lets the LLM say "what's on radar right now?" and get a curated list, even when the user has not pasted a fresh dump.

## Read these first

| File | Why |
| :--- | :--- |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Skill registration. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP tool registration. |
| https://github.com/nirholas/scrape-smart-wallets | Reference for radar field shape. |

## Build this

1. Add `src/kol/radar.js` exporting:
    ```js
    export async function getRadarSignals({ category = 'pump-fun', limit = 20 })
    // category ∈ 'pump-fun' | 'new-mints' | 'volume-spike'
    // Returns [{ mint, name, symbol, signalType, score, ts }] from a JSON file the user can refresh manually.
    ```
2. Persist a checked-in fixture `src/kol/radar-fixture.json` with a small representative payload so the skill works without manual setup. Document at the top of `src/kol/radar.js` how to refresh: paste the latest gmgn radar JSON over `radar-fixture.json` (or extend prompt 14's ingest pattern later).
3. Register skill `kol.radar` in [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js).
4. Register MCP tool `kol_radar` in [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js).
5. Add `tests/kol-radar.test.js` asserting filter by category, limit cap, and stable sort by score desc.

## Out of scope

- Live scraping of gmgn (TOS).
- DB persistence.
- UI changes.

## Acceptance

- [ ] `node --check src/kol/radar.js` passes.
- [ ] `npx vitest run tests/kol-radar.test.js` passes.
- [ ] Skill + MCP tool callable.
- [ ] `npx vite build` passes.

## Test plan

1. Call the skill with default args; confirm sorted, capped output.
2. Pass `category: 'volume-spike'`; confirm only those entries.
3. Pass `limit: 1000`; confirm capped to 100 (or document the cap inline).

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
