# 29 — Agent celebrates graduations on screen

**Branch:** `feat/graduation-celebration`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

When an agent's tracked token graduates to AMM, the avatar should *react* — confetti / emote / one-shot sound. This is a small, high-leverage moment that sells the "embodied agent" pitch in demos.

## Read these first

| File | Why |
| :--- | :--- |
| [src/element.js](../../src/element.js) | Avatar wiring + how reactions are triggered today. |
| [src/agent-skills-pumpfun-hooks.js](../../src/agent-skills-pumpfun-hooks.js) | Lifecycle hooks — your hook joins this set. |
| [services/pump-graduations/](../../services/pump-graduations/) | Graduation event source. |
| [src/pump/agent-token-widget.js](../../src/pump/agent-token-widget.js) | UI for token state. |

## Build this

1. Add `src/pump/graduation-hook.js` exporting:
    ```js
    export function attachGraduationHook(agent, { mint })
    // Subscribes to graduation events for `mint`.
    // On graduation: agent.playEmote('celebrate') + spawns a confetti burst overlaid on the canvas (CSS / DOM, not three.js).
    // Returns detach.
    ```
2. Confetti: pure CSS / DOM. No new dep. Auto-removes after 4 seconds.
3. If `agent.playEmote('celebrate')` is not available, fall back to a 360° spin on the avatar root via the existing animation system.
4. Wire into [src/element.js](../../src/element.js): when the agent's `tracked-mint` attribute is set, attach on connect, detach on disconnect.
5. Add `tests/graduation-hook.test.js` mocking the graduation source and asserting:
    - Confetti element appears in DOM on graduation event.
    - Element is removed within 5 seconds.
    - Detach prevents future triggers.

## Out of scope

- Sound (later — needs licensing decisions).
- Multi-mint tracking.
- Persisting graduation events.

## Acceptance

- [ ] `node --check src/pump/graduation-hook.js` passes.
- [ ] `npx vitest run tests/graduation-hook.test.js` passes.
- [ ] On a real graduation, confetti shows over the agent.
- [ ] `npx vite build` passes.

## Test plan

1. Patch the graduation source to fire a fake event in dev mode; confirm visible celebration.
2. Confirm cleanup works on disconnect.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
