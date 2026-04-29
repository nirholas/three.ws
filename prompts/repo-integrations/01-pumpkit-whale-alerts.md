# 01 — Pumpkit whale-alert watcher as agent skill

**Branch:** `feat/pumpkit-whale-alerts`
**Source repo:** https://github.com/nirholas/pumpkit
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

The 3D agent already exposes pump.fun watch skills in [src/agent-skills-pumpfun-watch.js](../../src/agent-skills-pumpfun-watch.js), but it has no whale-buy detector. Pumpkit (TS) has a whale-alert module. Wiring it in turns "show me when a whale buys this token" into a single agent skill the LLM can invoke.

## Read these first

| File | Why |
| :--- | :--- |
| [src/agent-skills-pumpfun-watch.js](../../src/agent-skills-pumpfun-watch.js) | Existing watch skills — your new skill follows this shape exactly. |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Skill registration pattern — `registerPumpfunSkills(agent)`. |
| [src/agent-skills.js](../../src/agent-skills.js) | Top-level skill registry. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP tool registration pattern. |
| https://github.com/nirholas/pumpkit (whale-alert module) | The detection logic to port. Read the README and the whale-alert source file. |

## Build this

1. Add `src/pump/pumpkit-whale.js` exporting:
    ```js
    export async function watchWhaleTrades({ mint, minUsd = 5000, onTrade, signal })
    // Subscribes to pump.fun trade events for `mint` (use existing RPC client in src/pump/* — do not add a new dep unless pumpkit's whale module is already in node_modules; otherwise port the minimum logic).
    // Calls onTrade({ signature, wallet, sideBuy, usd, sol, ts }) for trades whose USD value >= minUsd.
    // Aborts when AbortSignal is triggered.
    ```
2. Register a skill `pumpfun.watchWhales` in [src/agent-skills-pumpfun-watch.js](../../src/agent-skills-pumpfun-watch.js):
    - Args: `{ mint: string, minUsd?: number, durationMs?: number }` (default duration 5 min, max 30 min)
    - Streams whale trades back as agent messages (use the existing `agent.say(...)` / streaming pattern visible in that file)
    - Cleans up its abort signal when duration elapses or the user cancels.
3. Register an MCP tool `pumpfun_watch_whales` in [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) with the same args, but returning a single batch of whale trades after `durationMs` instead of streaming (MCP tools here are request/response).
4. Add a vitest test `tests/pumpkit-whale.test.js` that mocks the trade source and asserts the skill emits only trades whose USD value clears `minUsd`.

## Out of scope

- Telegram delivery (separate prompt 04).
- Persisting whale alerts to DB.
- Listing all whales across all tokens.
- Adding a new RPC provider — reuse whatever `src/pump/*` already uses.

## Acceptance

- [ ] `node --check src/pump/pumpkit-whale.js` passes.
- [ ] `npx vitest run tests/pumpkit-whale.test.js` passes.
- [ ] Skill appears in `getSkills()` output and is callable from the agent.
- [ ] MCP tool appears in `tools/list` for the pump-fun MCP endpoint.
- [ ] `npx vite build` passes.

## Test plan

1. `npx vitest run tests/pumpkit-whale.test.js` — green.
2. Boot dev server (`npm run dev`), open the agent, call the `pumpfun.watchWhales` skill on a known active pump.fun mint with `minUsd: 100` and a 60-second duration; confirm whale events stream into chat.
3. `curl -X POST http://localhost:3000/api/pump-fun-mcp` with the JSON-RPC `tools/list` request; confirm `pumpfun_watch_whales` is listed.

## Reporting

Append a section at the end of the PR description:

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
