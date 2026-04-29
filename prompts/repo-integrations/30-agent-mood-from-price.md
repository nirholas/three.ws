# 30 — Agent mood derived from token price

**Branch:** `feat/agent-mood-price`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

When an agent has a tracked token, the avatar should subtly mirror its 5-minute price trend — happier on green, slumped on red. This is a passive ambient signal that makes a long demo feel alive without scripted choreography.

## Read these first

| File | Why |
| :--- | :--- |
| [src/element.js](../../src/element.js) | Animation / pose entry points. |
| [src/agent-skills-pumpfun-hooks.js](../../src/agent-skills-pumpfun-hooks.js) | Hook patterns. |
| [src/pump/agent-token-widget.js](../../src/pump/agent-token-widget.js) | Existing price source. |

## Build this

1. Add `src/pump/mood-from-price.js` exporting:
    ```js
    export function attachMoodFromPrice(agent, { mint, intervalMs = 30_000 })
    // Polls the 5-minute price delta for `mint`.
    // Maps:
    //   delta > +5%  → 'happy'
    //   delta < -5%  → 'sad'
    //   between      → 'neutral'
    // Calls agent.setMood(mood) — implement that on the agent if it doesn't exist (find best home in src/element.js).
    // Returns detach.
    ```
2. Implement `agent.setMood(mood)` minimally: select an idle animation per mood (happy / neutral / sad) from the existing animation list. If a matching idle is not present, fall back to neutral and console.warn once.
3. Wire into [src/element.js](../../src/element.js): on connect, if `tracked-mint` is set, attach.
4. Add `tests/mood-from-price.test.js` asserting the threshold logic and that `setMood` is called with the right value.

## Out of scope

- Facial morph targets — pose-only is enough.
- Per-user mood overrides.
- Listening to news / sentiment in the same hook.

## Acceptance

- [ ] `node --check src/pump/mood-from-price.js` passes.
- [ ] `npx vitest run tests/mood-from-price.test.js` passes.
- [ ] In a dev stub (force a +10% delta), the avatar visibly shifts pose.
- [ ] `npx vite build` passes.

## Test plan

1. Force the price source to return +10% delta; confirm pose change.
2. Force −10%; confirm reverse.
3. Detach and confirm polling stops.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
