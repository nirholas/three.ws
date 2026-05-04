---
status: not-started
---

# Prompt 8: Backend - Creator Earnings API Endpoint

## Objective
Create a secure API endpoint to provide detailed earnings data for the logged-in creator.

## Explanation
This endpoint is the backbone of the Creator Earnings Dashboard. It needs to securely authenticate the user, query the database for all their sales, calculate summary statistics, and return the data in a clean, organized format for the frontend to consume.

## Instructions
1.  **Create the API Route:**
    *   Create a new file: `/api/users/earnings.js`.

2.  **Implement Authentication:**
    *   The endpoint must be protected. Use your existing session management (e.g., `getSessionUser`) to get the `userId` of the requester.
    *   If the user is not authenticated, return a `401 Unauthorized` error.

3.  **Query the Database:**
    *   Write a SQL query to fetch sales data for the authenticated `userId`.
    *   You will need to join several tables:
        *   Start with a table that records sales or royalty payments (e.g., `royalty_ledger`).
        *   Join with `agent_skill_prices` or a similar table to get skill details.
        *   Join with `agents` to get agent names.
    *   The query should select all necessary columns: date, skill name, agent name, price, currency, and payment status.
    *   Order the results by date, descending.

4.  **Calculate Summary Data:**
    *   After fetching the rows, use code to calculate the total revenue and the amount pending payout.
    *   This is often more efficient than running separate aggregate SQL queries.

5.  **Format and Return the Response:**
    *   Structure the response as a JSON object containing the summary figures and an array of the detailed transaction history.

## Code Example (`/api/users/earnings.js`)

```javascript
import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { json, error, wrap } from '../_lib/http.js';

export default wrap(async (req, res) => {
  if (req.method !== 'GET') return error(res, 405);

  const user = await getSessionUser(req);
  if (!user) return error(res, 401, 'unauthorized');

  const sales = await sql`
    SELECT
      r.created_at,
      s.skill_name,
      a.name AS agent_name,
      r.price_usd,
      r.status
    FROM royalty_ledger r
    JOIN agent_skill_prices s ON s.id = r.skill_price_id
    JOIN agents a ON a.id = s.agent_id
    WHERE r.author_user_id = ${user.id}
    ORDER BY r.created_at DESC
    LIMIT 100;
  `;

  const total_revenue = sales.reduce((sum, r) => sum + Number(r.price_usd), 0);
  const pending_payout = sales
    .filter(r => r.status === 'pending')
    .reduce((sum, r) => sum + Number(r.price_usd), 0);

  return json(res, 200, {
    total_revenue,
    pending_payout,
    history: sales,
  });
});
```
