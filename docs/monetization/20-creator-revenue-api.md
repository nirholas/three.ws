---
status: not-started
---

# Prompt 20: Creator Revenue API

## Objective
Implement the backend API endpoints required to populate the Creator Dashboard with revenue and transaction data.

## Explanation
The Creator Dashboard UI needs data to be useful. This task involves creating authenticated endpoints that aggregate and return a creator's financial data from the database.

## Instructions
1.  **Create a Summary Stats Endpoint:**
    *   Create an endpoint like `GET /api/creators/me/stats`.
    *   This endpoint should calculate several key metrics for the logged-in user (creator):
        *   **Total Revenue:** Sum the `amount` from all successful purchases (`user_unlocked_skills` joined with prices) and subscription payments (`user_subscriptions` joined with tier prices). This is complex and may require querying transaction logs. A simpler start is to sum from your own records.
        *   **30-Day Revenue:** The same calculation, but limited to the last 30 days.
        *   **Total Subscribers:** Count the number of `active` subscriptions for all of the creator's agents.
        *   **Total Sales:** Count the number of records in `user_unlocked_skills` for the creator's agents.

2.  **Create a Transactions Endpoint:**
    *   Create an endpoint like `GET /api/creators/me/transactions`.
    *   This should return a paginated list of all revenue-generating events for the creator.
    *   You will need to `UNION` results from two sources:
        *   Skill purchases from `user_unlocked_skills`.
        *   Subscription payments (you may need a new `subscription_payments` table for this, or infer it from `user_subscriptions`).
    *   Each item in the result should have a consistent shape, e.g., `{ date, type: 'sale' | 'subscription', description, amount, currency, status }`.

3.  **Create a Chart Data Endpoint:**
    *   Create an endpoint like `GET /api/creators/me/revenue-chart`.
    *   This endpoint should return data formatted for a charting library.
    *   It should accept a time range parameter (e.g., `?range=30d` or `?range=12m`).
    *   The backend should group revenue by day, week, or month and return an array of data points, e.g., `[{ date: 'YYYY-MM-DD', revenue: 15.50 }]`.

4.  **Security:**
    *   Ensure all endpoints are authenticated and strictly scoped to the data owned by the logged-in user. A creator should never be able to see another creator's revenue.

## Code Example (Backend - Summary Stats Logic)

```javascript
// GET /api/creators/me/stats
app.get('/api/creators/me/stats', async (req, res) => {
  const userId = await getUserIdFromRequest(req);

  // Query for total sales revenue
  const salesResult = await db.query(`
    SELECT SUM(p.amount)
    FROM user_unlocked_skills u
    JOIN agents a ON u.agent_id = a.id
    JOIN agent_skill_prices p ON u.agent_id = p.agent_id AND u.skill_name = p.skill_name
    WHERE a.owner_id = $1
  `, [userId]);

  // Query for active subscribers
  const subsResult = await db.query(`
    SELECT COUNT(*)
    FROM user_subscriptions s
    JOIN agent_subscription_tiers t ON s.tier_id = t.id
    JOIN agents a ON t.agent_id = a.id
    WHERE a.owner_id = $1 AND s.status = 'active'
  `, [userId]);

  // ... and so on for other stats.
  // These queries can be complex and should be optimized.

  res.json({
    total_revenue: (salesResult.rows[0].sum || 0) / 1e6, // Example
    total_subscribers: parseInt(subsResult.rows[0].count, 10),
    // ... other stats
  });
});
```

## Frontend Integration
The frontend JavaScript for `creator-dashboard.html` will call these new endpoints upon loading and use the returned data to populate the elements created in the previous step.
