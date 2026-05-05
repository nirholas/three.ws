# 08 — Revenue page: render real `/api/billing/revenue` data

## Problem
[pump-dashboard.html](../../pump-dashboard.html) lines ~545–547 contain only:

```html
<div class="content page" id="page-revenue" style="display:none">
    <!-- Content will be rendered here by dashboard.js -->
</div>
```

There is no `dashboard.js`. The Revenue tab is empty. This is a half-finished feature shipped to production and violates [CLAUDE.md](../../CLAUDE.md) (definition of done — feature must be reachable).

## Outcome
Selecting **Revenue** from the sidebar fetches `GET /api/billing/revenue` (already implemented in [api/billing/revenue.js](../../api/billing/revenue.js)) and renders:
- Summary stat-card row: gross, fees, net, payment count, currency mint, chain.
- "By skill" table sorted by net descending.
- Time-series chart (canvas line plot, daily granularity, last 30 days by default).
- Filter controls: agent picker (populated from `GET /api/agents`), granularity selector (day/week/month), date range pickers (`from`, `to`).

## Endpoints to use (already exist)
- `GET /api/billing/revenue?agent_id=…&granularity=day&from=…&to=…` — see [api/billing/revenue.js](../../api/billing/revenue.js). Returns `{ summary, by_skill, timeseries }`.
- `GET /api/agents` — see [api/agents.js](../../api/agents.js).

## Implementation
1. Build the markup inside `#page-revenue` directly — keep the same `.panel` / `.stats-grid` / table styling already in this file. No external `dashboard.js` script; inline this with the rest of the dashboard JS, or extract a real ES module like `src/pump/dashboard-revenue.js` and import it.
2. On nav into the Revenue page (and once on initial DOMContentLoaded if it's the active page), parallel-fetch:
   - `GET /api/billing/revenue` with current filter state.
   - `GET /api/agents` to populate the agent picker.
3. Render numbers with the correct decimals derived from `summary.currency_mint`. For SPL token mints, look up decimals via `getAccountInfo` through `/api/wallet/balances` or a dedicated mint-info endpoint — **do not hardcode 6** for any mint other than the canonical USDC mint, and do not assume SOL.
4. Time-series chart: vanilla canvas line (no new dependency). Re-use the canvas approach from task 03 if that task is also being done; otherwise self-contain it here. No fake animation, no `setTimeout` smoothing.
5. Real states:
   - Loading: skeleton stat cards + a "Loading…" line in the chart canvas.
   - 401: render "Sign in to view revenue" + link to `/login.html`.
   - Empty (`payment_count === 0`): render real "No revenue events in this window" — do not invent rows.
6. Add a "Refresh" button next to the filters that re-fetches with the current filter state.

## Definition of done
- Network tab shows real `/api/billing/revenue` and `/api/agents` calls succeeding.
- Numbers match a direct `curl /api/billing/revenue` for the same filters.
- Changing granularity from day → month re-fetches and re-renders the chart with fewer, larger buckets.
- The HTML comment `<!-- Content will be rendered here by dashboard.js -->` is gone.
- `npm test` green; **completionist** subagent run on changed files.
