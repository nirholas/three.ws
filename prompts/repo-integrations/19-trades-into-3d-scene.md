# 19 — Wire pump.fun trades into 3D agent scene

**Branch:** `feat/trades-into-3d-scene`
**Source repo:** https://github.com/nirholas/visualize-web3-realtime
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

The 3D agent is the centerpiece of this platform. Right now the avatar reacts to chat. Letting it react to pump.fun trade events — flinch on a sell-off, smile on a green candle — makes the avatar feel embodied and gives long-tail demos something fun to watch.

## Read these first

| File | Why |
| :--- | :--- |
| [src/element.js](../../src/element.js) | Custom-element + scene wiring. |
| [src/agent-skills-pumpfun-hooks.js](../../src/agent-skills-pumpfun-hooks.js) | Existing lifecycle hooks — your hook joins this set. |
| [src/agent-skills-pumpfun-watch.js](../../src/agent-skills-pumpfun-watch.js) | Trade subscription source. |
| https://github.com/nirholas/visualize-web3-realtime | Reference for trade-event shape. |

## Build this

1. Add `src/pump/trade-reactions.js` exporting:
    ```js
    export function attachTradeReactions(agent, { mint, intensity = 1 })
    // Subscribes to live trades for `mint`. On significant events, calls agent reaction methods:
    //   - large buy → agent.playEmote('cheer')
    //   - large sell → agent.playEmote('flinch')
    //   - graduation → agent.playEmote('celebrate')
    // Significance threshold: top 10% of trades in a rolling 5-min window.
    // Returns a detach function.
    ```
2. Wire it into [src/element.js](../../src/element.js) so when an agent has a `trackedMint` attribute, reactions auto-attach on connect and detach on disconnect.
3. If the agent's avatar exposes no matching emote (`cheer` / `flinch` / `celebrate`), fall back to a head-bob via the existing animation system (read `src/element.js` to find the entry point).
4. Add `tests/trade-reactions.test.js` mocking the trade source and asserting:
    - Below-threshold trades do not trigger emotes.
    - Above-threshold trades do.
    - Detach stops further triggers.

## Out of scope

- Adding new emote files. Use whatever's in the animation gallery.
- Editing the studio UI to set `trackedMint` (that's a later task).
- Multi-mint tracking per agent.

## Acceptance

- [ ] `node --check src/pump/trade-reactions.js` passes.
- [ ] `npx vitest run tests/trade-reactions.test.js` passes.
- [ ] An agent with `tracked-mint="<mint>"` triggers visible reactions when large trades happen.
- [ ] `npx vite build` passes.

## Test plan

1. `npm run dev`. Open `agent-page.html` for an agent and add the attribute. Wait for a large trade on a known active mint.
2. Confirm the avatar emotes (or head-bobs as fallback).
3. Remove the attribute, refresh, confirm no subscriptions remain (devtools network tab).

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
