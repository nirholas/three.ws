# 18 — Real-time trade visualizer widget

**Branch:** `feat/realtime-trade-viz-widget`
**Source repo:** https://github.com/nirholas/visualize-web3-realtime
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

visualize-web3-realtime renders pump.fun / Raydium / Uniswap / PancakeSwap trades as physics-based particle nodes. Adding a `live-trades-canvas` widget type lets any embed show that visualization scoped to a single mint — a big visual upgrade over a text feed.

## Read these first

| File | Why |
| :--- | :--- |
| [src/widget-types.js](../../src/widget-types.js) | Widget type registry. |
| [src/element.js](../../src/element.js) | Custom-element wiring. |
| [src/pump/agent-token-widget.js](../../src/pump/agent-token-widget.js) | Closest existing widget. |
| https://github.com/nirholas/visualize-web3-realtime | Particle physics + canvas reference. |

## Build this

1. Register a new widget type `live-trades-canvas` in [src/widget-types.js](../../src/widget-types.js):
    - Required attribute: `mint`
    - Optional: `chain` (default `solana`, accepts `solana` only in v1), `bg` (color hex), `min-usd` (default 0)
2. Add `src/widgets/live-trades-canvas.js` exporting `mountLiveTradesCanvas(rootEl, opts)`:
    - Subscribes to pump.fun trades for `mint` (reuse the existing trade subscription in `src/pump/*` — don't add a new RPC dep).
    - Each trade pops in as a particle (size ~ log(USD)), buys = green, sells = red, fades out over 5–10s.
    - Cleanup detaches subscription + cancels animation frame.
3. Add `tests/live-trades-canvas.test.js` rendering the widget with a mocked subscription source and asserting particles are added/removed correctly (test the data layer, not pixel output).

## Out of scope

- Multi-chain support (Solana only v1).
- 3D rendering / Three.js — 2D canvas is enough.
- Particle physics tuning beyond a single tasteful default.

## Acceptance

- [ ] `node --check src/widgets/live-trades-canvas.js` passes.
- [ ] `npx vitest run tests/live-trades-canvas.test.js` passes.
- [ ] `<three-ws-widget type="live-trades-canvas" mint="<mint>"></three-ws-widget>` renders a moving canvas in `embed-test.html`.
- [ ] `npx vite build` passes.

## Test plan

1. Add the widget tag to `embed-test.html` against a known active mint. Confirm particles appear.
2. Set `min-usd="500"`. Confirm fewer particles.
3. Move browser tab to background; confirm no runaway CPU when re-foregrounded.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
