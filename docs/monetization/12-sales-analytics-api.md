# Prompt 12: Sales Analytics API

## Objective
Create a secure backend API endpoint that retrieves and aggregates sales data for a creator's agents.

## Explanation
The creator dashboard needs data to display. This endpoint will be responsible for querying the database (or blockchain data) to provide the necessary analytics, such as total revenue and sales volume, for the currently logged-in creator.

## Instructions
1.  **Record Sales Data:**
    *   First, you need data to query. In the `/api/skills/mint` endpoint from Prompt 7, after a successful mint, you must save a record of the sale to a new `sales` table in your database.
    *   The `sales` table should include `id`, `agent_id`, `skill_name`, `price`, `currency`, `buyer_wallet`, `transaction_signature`, and a `timestamp`.

2.  **Create Analytics Endpoint:**
    *   Create a new endpoint, `/api/dashboard/analytics`.
    *   This endpoint must be authenticated, ensuring a user can only access their own sales data. It should get the `user_id` from the session.

3.  **Query and Aggregate Data:**
    *   In the endpoint logic:
        *   Find all agents owned by the logged-in user.
        *   Query the `sales` table for all sales related to those agents.
        *   Use SQL `SUM()` and `COUNT()` to aggregate the data to calculate:
            *   Total revenue.
            *   Total number of sales.
            *   Sales data grouped by day or month for the chart.

4.  **Return Data:**
    *   Return the aggregated data in a structured JSON format that the frontend can easily consume.

## Code Example (Backend Endpoint - `/api/dashboard/analytics.js`)
```javascript
// This is a conceptual example using a SQL-like query builder

async function getAnalytics(req, res) {
    const userId = req.session.userId; // Get user ID from session
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Query the database
    const result = await db.query(
        `SELECT
            SUM(price) as total_revenue,
            COUNT(id) as total_sales,
            DATE_TRUNC('day', timestamp) as date,
            COUNT(id) as daily_sales
         FROM sales
         WHERE agent_id IN (SELECT id FROM agents WHERE owner_id = $1)
         GROUP BY DATE_TRUNC('day', timestamp)
         ORDER BY date ASC;
        `, [userId]
    );
    
    // Process and return data
    const analyticsData = {
        totalRevenue: result.rows.reduce((acc, row) => acc + parseFloat(row.total_revenue), 0),
        totalSales: result.rows.reduce((acc, row) => acc + parseInt(row.total_sales), 0),
        salesOverTime: result.rows.map(row => ({
            date: row.date,
            sales: row.daily_sales
        }))
    };

    res.status(200).json(analyticsData);
}
```
