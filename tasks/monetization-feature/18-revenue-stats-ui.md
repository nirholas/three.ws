# Prompt 18: Revenue Stats API and UI

## Objective
Create a backend API endpoint to calculate and return key revenue statistics for a user, and then display these stats in the new Revenue Dashboard.

## Explanation
A high-level overview is the most important part of a dashboard. We need to provide creators with key metrics like their current balance, total lifetime revenue, and recent earnings. This requires a backend endpoint that can efficiently query the `agent_revenue_events` table and aggregate the data.

## Instructions
1.  **Create the Backend API Endpoint:**
    *   Create a new file: `/api/billing/revenue-stats.js`.
    *   This `GET` endpoint must be authenticated.
    *   It should query the `agent_revenue_events` table, joined with `agent_identities` to filter by the current `user_id`.
    *   Use SQL aggregate functions (`SUM`, `COUNT`) to calculate:
        *   `total_revenue_gross`: The sum of `gross_amount` for all time.
        *   `total_revenue_net`: The sum of `net_amount` for all time.
        *   `earnings_last_30_days`: The sum of `net_amount` where `created_at` is within the last 30 days.
        *   `current_balance`: The sum of `net_amount` minus the sum of all withdrawals for this user (from `agent_withdrawals` table).
    *   Return these values in a JSON object.

2.  **Update the Frontend Dashboard:**
    *   In `public/dashboard/dashboard.js`, modify the `renderRevenue` function.
    *   After rendering the initial HTML shell, make a `fetch` call to your new `/api/billing/revenue-stats` endpoint.
    *   Create a new function, e.g., `renderStats(stats)`, that takes the API response and generates the HTML for a grid of stat cards.
    *   Each card should display a label (e.g., "Net Lifetime Revenue") and the formatted value. Make sure to convert amounts from the smallest unit to a human-readable currency format (e.g., divide by 1,000,000 for USDC and format with a dollar sign).
    *   Handle loading and error states gracefully.

## Code Example (Backend - `/api/billing/revenue-stats.js`)

```javascript
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { json, wrap, error } from '../_lib/http.js';

export default wrap(async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) return error(res, 401, 'unauthorized');

    // This query is complex and joins multiple tables.
    // For simplicity, we'll do separate queries. A single, more optimized query is better in production.
    
    const [revenue] = await sql`
        SELECT
            SUM(rev.net_amount) AS total_net,
            SUM(CASE WHEN rev.created_at >= NOW() - INTERVAL '30 days' THEN rev.net_amount ELSE 0 END) AS last_30_days
        FROM agent_revenue_events rev
        JOIN agent_identities ai ON rev.agent_id = ai.id
        WHERE ai.user_id = ${user.id}
    `;

    const [withdrawals] = await sql`
        SELECT SUM(amount) AS total_withdrawn
        FROM agent_withdrawals
        WHERE user_id = ${user.id} AND status = 'completed'
    `;

    const total_net = BigInt(revenue.total_net || 0);
    const total_withdrawn = BigInt(withdrawals.total_withdrawn || 0);
    const current_balance = total_net - total_withdrawn;

    return json(res, 200, {
        total_revenue_net: String(total_net),
        earnings_last_30_days: String(revenue.last_30_days || 0),
        current_balance: String(current_balance),
    });
});
```

## Code Example (Frontend - `public/dashboard/dashboard.js`)

```javascript
async function renderRevenue(root) {
    root.innerHTML = `
        <div class="page-header">
            <h1>Revenue</h1>
            <p class="sub">Track your earnings from paid agent skills.</p>
        </div>
        <div class="stats-grid" id="revenue-stats-grid">
            <div class="stat-card">Loading...</div>
        </div>
        <div id="revenue-events-table-container"></div>
    `;

    try {
        const stats = await api.getRevenueStats(); // Assumes an api helper exists
        renderRevenueStats(stats);
    } catch (e) {
        document.getElementById('revenue-stats-grid').innerHTML = `<div class="err">Failed to load stats: ${e.message}</div>`;
    }
}

function renderRevenueStats(stats) {
    const grid = document.getElementById('revenue-stats-grid');
    
    const formatUSDC = (amount) => `$${(Number(amount) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    grid.innerHTML = `
        <div class="stat-card">
          <div class="label">Current Balance</div>
          <div class="value green">${formatUSDC(stats.current_balance)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Net Earnings (30 Days)</div>
          <div class="value">${formatUSDC(stats.earnings_last_30_days)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Lifetime Net Revenue</div>
          <div class="value">${formatUSDC(stats.total_revenue_net)}</div>
        </div>
    `;
}
```
You would also need to add a helper for `/api/billing/revenue-stats` to your `api` object in `dashboard.js`.
