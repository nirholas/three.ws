# 31 — Live signals embed widget

**Branch:** `feat/live-signals-widget`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

A single `signals-feed` widget that surfaces the most relevant live signals for a token (whales + claims + graduations) gives third-party sites one drop-in line of HTML to embed and stay in sync with what's happening on chain.

## Read these first

| File | Why |
| :--- | :--- |
| [src/widget-types.js](../../src/widget-types.js) | Widget type registry. |
| [src/element.js](../../src/element.js) | Custom-element wiring. |
| [src/pump/agent-token-widget.js](../../src/pump/agent-token-widget.js) | Closest pattern. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | Existing pump-data endpoints — read-through pattern. |

## Build this

1. Register a `signals-feed` widget type in [src/widget-types.js](../../src/widget-types.js):
    - Required: `mint`
    - Optional: `kinds` (csv: `whale,claim,graduation`, default all), `refresh-ms` (default 20000), `theme` (`dark` | `light`, default `dark`).
2. Add `src/widgets/signals-feed.js` exporting `mountSignalsFeed(rootEl, opts)`:
    - Polls a new `/api/pump/signals?mint=…&kinds=…` endpoint that internally aggregates whale events, claims, and graduations for the mint.
    - Renders rows with kind-specific icons, timestamp, summary, link to Solscan.
    - Empty + loading + error states.
    - Cleanup on unmount.
3. Add `api/pump/signals.js` endpoint aggregating whatever sources the project already has. Do not add new RPC subs — read-through only.
4. Add `tests/signals-feed.test.js` (jsdom + mocked fetch) asserting filter-by-kinds works and rows render.

## Out of scope

- Push (WebSocket) — polling is fine.
- Personalization beyond `theme`.
- Multi-mint feeds.

## Acceptance

- [ ] `node --check` passes for new files.
- [ ] `npx vitest run tests/signals-feed.test.js` passes.
- [ ] `<three-ws-widget type="signals-feed" mint="<mint>"></three-ws-widget>` renders rows in `embed-test.html`.
- [ ] `npx vite build` passes.

## Test plan

1. Add to `embed-test.html` for a known active mint. Confirm rows populate.
2. Set `kinds="graduation"`. Confirm only graduations render.
3. Disable network; confirm error state.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
