# 21 — Bonding-curve chart component

**Branch:** `feat/bonding-curve-chart`
**Source repo:** https://github.com/nirholas/solana-launchpad-ui
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

A reusable bonding-curve chart is useful in (1) the launch form, (2) the agent-token widget, and (3) any embed visualizing pre-graduation tokens. Today we draw nothing. solana-launchpad-ui has the visual; this prompt extracts a single small component we can drop anywhere — independent of prompt 20.

## Read these first

| File | Why |
| :--- | :--- |
| [src/pump/agent-token-widget.js](../../src/pump/agent-token-widget.js) | Where the chart will be consumed. |
| [src/widget-types.js](../../src/widget-types.js) | If we end up exposing as a widget. |
| https://github.com/nirholas/solana-launchpad-ui | Bonding-curve reference. |

## Build this

1. Add `src/components/bonding-curve.js` exporting:
    ```js
    export function mountBondingCurve(rootEl, { progressPct = 0, marketCapUsd = 0, graduationCapUsd = 69_000 })
    // Renders a responsive SVG curve, with a marker at the current `progressPct`.
    // Updates can be made via the returned `update({ progressPct, marketCapUsd })` function.
    // Returns { update, destroy }.
    ```
2. Use SVG (no canvas). No new deps.
3. Visual style: match existing pump UI (dark, mono-friendly).
4. Use it in [src/pump/agent-token-widget.js](../../src/pump/agent-token-widget.js) — replace any hardcoded progress bar with this curve. If no progress bar exists, add the curve under the price block.
5. Add `tests/bonding-curve.test.js` (jsdom) asserting:
    - SVG renders.
    - `update({ progressPct: 50 })` moves the marker.

## Out of scope

- Live data subscription (the consumer passes values in).
- Animations beyond a 200ms marker tween.
- 3D rendering.

## Acceptance

- [ ] `node --check src/components/bonding-curve.js` passes.
- [ ] `npx vitest run tests/bonding-curve.test.js` passes.
- [ ] Component visible in the agent-token widget when a pre-graduation token is shown.
- [ ] `npx vite build` passes.

## Test plan

1. `npm run dev`. Open an embed showing a pre-graduation token; confirm the curve renders.
2. Call `update({ progressPct: 90 })` from devtools; confirm the marker animates.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
