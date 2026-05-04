# Prompt 12: Creator Earnings and Dashboard

## Status
- [ ] Not Started

## Objective
Develop a dashboard for agent creators to view their total earnings and a list of their sales.

## Explanation
To create a complete ecosystem, creators need visibility into their monetization performance. This prompt outlines the creation of a private dashboard where they can track their earnings.

## Instructions
1.  **Create a Sales/Earnings Table:**
    *   Design a new database table, e.g., `skill_sales`, to log every successful sale.
    *   Columns should include: `id`, `agent_id`, `skill_name`, `buyer_id`, `seller_id`, `amount`, `currency_mint`, `transaction_signature`, and `created_at`.

2.  **Log Sales on Purchase:**
    *   Modify the `/api/payments/finalize-purchase` endpoint from Prompt 8.
    *   After recording skill ownership, add another step to insert a record into the new `skill_sales` table.

3.  **Create a Backend API for the Dashboard:**
    *   Create a new authenticated endpoint, e.g., `GET /api/creator/dashboard`.
    *   This endpoint should:
        *   Calculate the creator's total earnings by summing the `amount` from the `skill_sales` table, grouped by currency.
        *   Fetch a list of recent sales transactions for the creator.

4.  **Build the Frontend Dashboard:**
    *   Create a new page, `creator-dashboard.html`, accessible only to logged-in users.
    *   On this page, fetch data from the new dashboard API.
    *   Display the total earnings and the list of recent sales in a clear and readable format.

## SQL for `skill_sales`
```sql
CREATE TABLE skill_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id),
    skill_name VARCHAR(255) NOT NULL,
    buyer_id UUID NOT NULL REFERENCES users(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    amount BIGINT NOT NULL,
    currency_mint VARCHAR(255) NOT NULL,
    transaction_signature VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_skill_sales_on_seller_id ON skill_sales (seller_id);
```

## Code Example (Backend - `/api/creator/dashboard.js`)
```javascript
// Example using a hypothetical DB utility
import { db } from './_db.js';
import { getUserIdFromRequest } from './_auth.js';

export default async function handler(req, res) {
  const userId = await getUserIdFromRequest(req);

  // 1. Get total earnings
  const earningsResult = await db.query(
    `SELECT currency_mint, SUM(amount) as total_earned
     FROM skill_sales
     WHERE seller_id = $1
     GROUP BY currency_mint`,
    [userId]
  );
  const totalEarnings = earningsResult.rows;

  // 2. Get recent sales
  const salesResult = await db.query(
    `SELECT skill_name, amount, currency_mint, created_at, transaction_signature
     FROM skill_sales
     WHERE seller_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId]
  );
  const recentSales = salesResult.rows;
  
  res.status(200).json({ totalEarnings, recentSales });
}
```
