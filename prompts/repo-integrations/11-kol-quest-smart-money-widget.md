# 11 — KOL-quest smart money widget

**Branch:** `feat/kol-smart-money-widget`
**Source repo:** https://github.com/nirholas/kol-quest
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

The platform already supports embeddable widgets ([src/widget-types.js](../../src/widget-types.js)). Adding a "smart money" widget that surfaces what KOL/whale wallets are buying — the core feature of kol-quest — gives any embed (3D agent home, third-party site) a live, glanceable signal feed. This is one new widget type, scoped to a single token mint at a time.

## Read these first

| File | Why |
| :--- | :--- |
| [src/widget-types.js](../../src/widget-types.js) | Widget type registry — your new type goes here. |
| [src/element.js](../../src/element.js) | Widget custom-element wiring. |
| [src/pump/agent-token-widget.js](../../src/pump/agent-token-widget.js) | Closest existing widget pattern. |
| https://github.com/nirholas/kol-quest | Source for trade-feed + KOL-detection logic to reference. |

## Build this

1. Add a `kol-trades` widget type in [src/widget-types.js](../../src/widget-types.js) with:
    - Required attribute: `mint`
    - Optional: `limit` (default 20), `refresh-ms` (default 30000)
2. Add `src/widgets/kol-trades.js` exporting a `mountKolTradesWidget(rootEl, opts)` that:
    - Polls a new endpoint `/api/kol/trades?mint=…&limit=…` every `refresh-ms`.
    - Renders rows: time, side (buy/sell), wallet (truncated, link to Solscan), USD, source-tag (kol / whale / smart-money).
    - Empty state.
    - Cleanup on unmount.
3. Add `api/kol/trades.js` returning recent trades for a mint, joined against a smart-money wallet list (port the wallet-detection rule from kol-quest's README — minimum P&L threshold). The wallet list source can be a stub array in `src/kol/wallets.js` (one new file) — leave a TODO inline if a richer source is desired later.
4. Add `tests/kol-trades-widget.test.js` asserting the endpoint shape and that the widget renders rows from a mocked fetch.

## Out of scope

- Multi-mint dashboards (one widget = one mint).
- DB-backed wallet list (stub is fine for v1).
- Editing the widget visually in the studio (later).

## Acceptance

- [ ] `node --check` passes for new files.
- [ ] `npx vitest run tests/kol-trades-widget.test.js` passes.
- [ ] `<three-ws-widget type="kol-trades" mint="<mint>"></three-ws-widget>` renders.
- [ ] `/api/kol/trades?mint=…` returns valid JSON.
- [ ] `npx vite build` passes.

## Test plan

1. `npm run dev`. Embed the widget in `embed-test.html`. Confirm rows populate within 30s.
2. Pass an unknown mint; confirm the empty state.
3. Stop the dev server during a refresh; confirm no unhandled rejection.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
