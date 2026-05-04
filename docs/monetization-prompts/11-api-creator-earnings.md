# Prompt 11: API Endpoint for Creator Earnings Data

## Objective
Create a secure API endpoint that calculates and returns a creator's earnings data for their dashboard.

## Explanation
The creator dashboard needs data to display. This endpoint will query the database to aggregate sales data for the currently authenticated user, providing them with their total revenue, balance, and a list of recent transactions.

## Instructions
1.  **Create the API Endpoint File:**
    *   Create a new file, e.g., `api/dashboard/earnings.js`.

2.  **Implement the Endpoint Logic:**
    *   **Authentication:** Get the current user via `getSessionUser`.
    *   **Query for Total Revenue:**
        *   Write a SQL query that `SUM`s the `amount` from `user_skill_purchases` where the `creator_id` matches the current user and the `status` is `'confirmed'`.
    *   **Query for Recent Transactions:**
        *   Write a SQL query that fetches the last 50-100 confirmed purchases for the creator.
        *   Join with `agent_identities` and `agent_skill_prices` to get agent names, skill names, and prices.
    *   **Calculate Withdrawable Balance:**
        *   For now, this can be the same as total revenue. In a future prompt, this will be adjusted for payouts.
    *   **Return Data:** Combine all the data into a single JSON response.

## SQL Query Example

```sql
-- Query to get recent sales for a specific creator
SELECT
    p.created_at,
    p.skill_id,
    a.name as agent_name,
    pr.amount,
    pr.currency_mint,
    p.status
FROM
    user_skill_purchases p
JOIN
    agent_skill_prices pr ON p.price_id = pr.id
JOIN
    agent_identities a ON p.agent_id = a.id
WHERE
    pr.creator_id = $1 -- creator's user_id
    AND p.status = 'confirmed'
ORDER BY
    p.created_at DESC
LIMIT 50;
```

## Code Example (`api/dashboard/earnings.js`)

```javascript
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { error, json, wrap } from '../_lib/http.js';

export default wrap(async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return error(res, 401, 'unauthorized');

  const [total] = await sql`
    SELECT SUM(pr.amount) as total_revenue
    FROM user_skill_purchases p
    JOIN agent_skill_prices pr ON p.price_id = pr.id
    WHERE pr.creator_id = ${user.id} AND p.status = 'confirmed'
  `;

  const sales = await sql` /* ... Use the SQL query from above ... */ `;

  return json(res, {
    totalRevenue: total.total_revenue || 0,
    withdrawableBalance: total.total_revenue || 0, // Placeholder for now
    recentSales: sales,
  });
});
```
