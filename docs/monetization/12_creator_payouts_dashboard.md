---
status: not-started
last_updated: 2026-05-04
---
# Prompt 12: Creator Payouts Dashboard

## Objective
Create a dashboard for creators to view their sales history and total earnings.

## Explanation
To provide transparency and a good creator experience, we need a dashboard that shows them how much they've earned from their paid skills. This involves aggregating data from the `user_purchased_skills` table and presenting it in a clear, easy-to-understand format.

## Instructions
1.  **Create a New Page:**
    *   Create a new HTML file for the dashboard, e.g., `creator-dashboard.html`.
    *   This page will be accessible to logged-in users from their profile or a main navigation link.

2.  **Backend API for Sales Data:**
    *   Create a new endpoint, e.g., `GET /api/creators/sales-data`.
    *   **Authentication:** Requires a logged-in user.
    *   **Database Query:**
        *   The endpoint should query the `user_purchased_skills` table.
        *   It needs to find all purchases where the `agent_id` belongs to an agent owned by the current user.
        *   It should aggregate the data to calculate:
            *   Total revenue (sum of `price_amount`).
            *   Number of sales.
            *   A list of recent sales transactions with details (skill name, agent name, price, date).
        *   The data should be grouped by currency if multiple currencies are supported in the future.

3.  **Frontend Implementation:**
    *   The `creator-dashboard.html` page's JavaScript will call the new API endpoint.
    *   **Display Key Metrics:** Show "Total Revenue" and "Total Sales" in prominent summary cards.
    *   **Display Sales History:** Render the list of recent transactions in a table or a list format. Each entry should be clear and provide essential information.
    *   **Add Charts (Optional but Recommended):** Use a charting library (like Chart.js) to visualize sales over time (e.g., daily or weekly revenue).

## Code Example (Backend API - `GET /api/creators/sales-data`)

```javascript
import { sql } from '../../_lib/db.js';
// ... other imports

export default wrap(async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) return error(res, 401, 'unauthorized');

    // 1. Get all agents owned by the user
    const userAgents = await sql`
        SELECT id FROM agent_identities WHERE user_id = ${user.id}
    `;
    const agentIds = userAgents.map(a => a.id);

    if (agentIds.length === 0) {
        return json(res, 200, { totalRevenue: 0, salesCount: 0, recentSales: [] });
    }

    // 2. Aggregate sales data for those agents
    const [salesData] = await sql`
        SELECT
            SUM(price_amount) AS total_revenue,
            COUNT(id) AS sales_count
        FROM user_purchased_skills
        WHERE agent_id = ANY(${agentIds})
    `;

    // 3. Get recent sales
    const recentSales = await sql`
        SELECT
            p.skill_name,
            a.name AS agent_name,
            p.price_amount,
            p.price_currency_mint,
            p.created_at
        FROM user_purchased_skills p
        JOIN agent_identities a ON p.agent_id = a.id
        WHERE p.agent_id = ANY(${agentIds})
        ORDER BY p.created_at DESC
        LIMIT 20
    `;

    return json(res, 200, {
        totalRevenue: parseInt(salesData.total_revenue) || 0,
        salesCount: parseInt(salesData.sales_count) || 0,
        recentSales: recentSales
    });
});
```
