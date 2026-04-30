# Task 10 — Frontend: Revenue Dashboard UI

## Goal
A dashboard page (or panel within the agent management UI) where agent owners can see their earnings: total revenue, per-skill breakdown, and a time-series chart.

## Success Criteria
- Shows gross/net revenue and payment count for selected time range
- Per-skill breakdown table with amounts
- Simple bar or line chart for daily/weekly earnings
- Date range picker (Last 7d / 30d / 90d / custom)
- Agent selector dropdown if user has multiple agents (or "All agents" default)
- Amounts rendered in human-readable USDC (divide lamports by 10^6, show "USDC")
- Empty state for users with no revenue yet

## Route/Location

Add a route `/dashboard/revenue` (or `/agents/:id/revenue` for per-agent view).

If there's an existing dashboard or billing page, add a "Revenue" section/tab there. Search for `billing`, `dashboard`, or `settings` pages in `src/`.

## Component: `RevenueDashboard`

```
RevenueDashboard
├── Header: "Revenue" + date range picker + agent selector
├── Summary Cards
│   ├── Gross Earnings: $X.XX USDC
│   ├── Platform Fees: -$X.XX USDC
│   ├── Net Earnings: $X.XX USDC
│   └── Payments: N transactions
├── Earnings Chart (bar chart, one bar per day/week)
└── Skill Breakdown Table
    ├── Skill | Net Earnings | Transactions
    └── ...rows...
```

## Data Source
`GET /api/billing/revenue` (Task 06).

Use `fetch` with the session cookie. On load, call with default `from=30 days ago`.

Re-fetch when date range or agent filter changes.

## Chart
Use a minimal vanilla SVG bar chart (no external charting lib) or a simple `<canvas>` bar chart. Match existing project style (no React, use vhtml JSX or plain DOM). Keep it under 100 lines.

## Amount Formatting Helper
```js
function formatUSDC(lamports) {
  return (lamports / 1_000_000).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' USDC';
}
```

## Files to Create/Touch
- `src/components/revenue-dashboard.jsx` — new component
- Wire into the existing routing/navigation (find where other dashboard routes are registered)

## Do NOT Build
- Real-time WebSocket updates (polling on page focus is fine)
- CSV export (future task)
- Multi-currency support in the chart (show primary currency only)

## Verify
1. Navigate to revenue dashboard → summary cards show (zeros if no revenue)
2. Change date range → numbers update
3. Complete a test payment → earnings appear within one page reload
4. With multiple agents → agent selector filters correctly
