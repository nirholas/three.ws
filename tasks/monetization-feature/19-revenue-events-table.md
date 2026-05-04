# Prompt 19: Revenue Events API and Table

## Objective
Create an API endpoint to fetch a paginated list of individual revenue events for a user, and display these events in a table on the Revenue Dashboard.

## Explanation
After seeing their high-level stats, creators will want to see the breakdown of their earnings. A transaction history, or "revenue events" list, provides this transparency. We need a paginated API to handle potentially large numbers of events, and a clean table on the frontend to display them.

## Instructions
1.  **Create the Backend API Endpoint:**
    *   Create a new file: `/api/billing/revenue-events.js`.
    *   This `GET` endpoint must be authenticated and should support cursor-based pagination (`?cursor=...`).
    *   Query the `agent_revenue_events` table, filtering by the agents owned by the current `user_id`.
    *   For each event, you should also join `agent_identities` to get the `agent_name`.
    *   Order the results by `created_at DESC`.
    *   Return a list of events and a `next_cursor` for the frontend to use for "Load More" functionality. Each event object should include details like date, skill name, agent name, and the net amount earned.

2.  **Update the Frontend Dashboard:**
    *   In `public/dashboard/dashboard.js`, create a new function `loadRevenueEvents`. Call this from within `renderRevenue` after the stats have been loaded.
    *   This function will fetch data from `/api/billing/revenue-events`.
    *   Create a rendering function `renderRevenueEventsTable(events)` that generates the HTML for a table.
    *   The table should have columns for: Date, Agent, Skill, and Net Amount.
    *   Display the data in the `#revenue-events-table-container` element.
    *   Implement a "Load More" button that appears if the API response includes a `next_cursor`. Clicking this button should fetch the next page and append the new rows to the table.

## Code Example (Backend - `/api/billing/revenue-events.js`)

```javascript
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { json, wrap, error } from '../_lib/http.js';

const PAGE_SIZE = 20;

export default wrap(async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) return error(res, 401, 'unauthorized');

    const url = new URL(req.url, 'http://x');
    const cursor = url.searchParams.get('cursor');

    const rows = await sql`
        SELECT
            rev.id,
            rev.created_at,
            rev.skill,
            rev.net_amount,
            ai.name AS agent_name
        FROM agent_revenue_events rev
        JOIN agent_identities ai ON rev.agent_id = ai.id
        WHERE ai.user_id = ${user.id}
          AND (${cursor}::timestamptz IS NULL OR rev.created_at < ${cursor})
        ORDER BY rev.created_at DESC
        LIMIT ${PAGE_SIZE + 1}
    `;
    
    const hasMore = rows.length > PAGE_SIZE;
    const events = rows.slice(0, PAGE_SIZE);
    const nextCursor = hasMore ? events[events.length - 1].created_at.toISOString() : null;

    return json(res, 200, {
        events,
        next_cursor: nextCursor,
    });
});
```

## Code Example (Frontend - `public/dashboard/dashboard.js`)

```javascript
async function renderRevenue(root) {
    // ... code to render page shell and stats ...
    
    // Add a container for the table
    root.querySelector('#revenue-events-table-container').innerHTML = `
        <div class="panel">
            <div class="panel-header"><h2>Transaction History</h2></div>
            <div class="panel-body no-pad">
                <table id="revenue-events-table">
                    <thead>
                        <tr><th>Date</th><th>Agent</th><th>Skill</th><th>Net Earning</th></tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
            <div class="panel-footer" id="revenue-load-more-container"></div>
        </div>
    `;

    loadRevenueEvents(); // Initial load
}

let eventsNextCursor = null;

async function loadRevenueEvents(cursor = null) {
    const container = document.getElementById('revenue-load-more-container');
    container.innerHTML = cursor ? '<button disabled>Loading...</button>' : '';

    try {
        const url = new URL('/api/billing/revenue-events', location.origin);
        if (cursor) url.searchParams.set('cursor', cursor);
        const res = await fetch(url, { credentials: 'include' });
        const { events, next_cursor } = await res.json();

        const tbody = document.querySelector('#revenue-events-table tbody');
        if (!cursor && !events.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;">No revenue events yet.</td></tr>';
            container.innerHTML = '';
            return;
        }

        const formatUSDC = (amount) => `$${(Number(amount) / 1e6).toFixed(2)}`;
        tbody.insertAdjacentHTML('beforeend', events.map(e => `
            <tr>
                <td>${new Date(e.created_at).toLocaleDateString()}</td>
                <td>${esc(e.agent_name)}</td>
                <td>${esc(e.skill)}</td>
                <td>${formatUSDC(e.net_amount)}</td>
            </tr>
        `).join(''));

        eventsNextCursor = next_cursor;
        if (next_cursor) {
            container.innerHTML = '<button id="rev-load-more">Load More</button>';
            document.getElementById('rev-load-more').addEventListener('click', () => loadRevenueEvents(eventsNextCursor));
        } else {
            container.innerHTML = '';
        }

    } catch (e) {
        container.innerHTML = `<div class="err">Failed to load history.</div>`;
    }
}
```
