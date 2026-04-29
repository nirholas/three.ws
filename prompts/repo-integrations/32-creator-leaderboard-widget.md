# 32 — Creator leaderboard widget

**Branch:** `feat/creator-leaderboard-widget`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

A `creator-leaderboard` widget — top pump.fun creators by graduations or fees claimed in a window — is a glanceable stat block any embed can drop in. Distinct from prompt 11 (KOL traders); this one ranks token *launchers*.

## Read these first

| File | Why |
| :--- | :--- |
| [src/widget-types.js](../../src/widget-types.js) | Widget type registry. |
| [src/pump/agent-token-widget.js](../../src/pump/agent-token-widget.js) | Closest pattern. |
| [api/](../../api/) | API conventions. |

## Build this

1. Register `creator-leaderboard` widget type:
    - Optional: `metric` (`graduations` | `feesClaimed`, default `graduations`), `window` (`24h` | `7d` | `30d`, default `7d`), `limit` (default 10).
2. Add `src/widgets/creator-leaderboard.js` polling `/api/pump/creator-leaderboard?metric=…&window=…&limit=…`.
3. Add `api/pump/creator-leaderboard.js` aggregating by creator over the requested window using existing pump data sources.
4. Add `tests/creator-leaderboard.test.js` asserting endpoint shape + sort order.

## Out of scope

- Per-creator drill-down inside the widget — link out to the agent page.
- DB-backed history.

## Acceptance

- [ ] `node --check` passes.
- [ ] `npx vitest run tests/creator-leaderboard.test.js` passes.
- [ ] Widget renders top creators in `embed-test.html`.
- [ ] `/api/pump/creator-leaderboard` returns valid JSON.
- [ ] `npx vite build` passes.

## Test plan

1. Embed widget. Confirm rows populate.
2. Switch `metric="feesClaimed"`. Confirm different ranking.
3. Pass `window="24h"`. Confirm shorter window response.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
