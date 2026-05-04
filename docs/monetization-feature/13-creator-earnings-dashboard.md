---
status: not-started
---

# Prompt 13: Creator Earnings/Dashboard Page

**Status:** Not Started

## Objective
Create a basic dashboard page for creators to see their total earnings and a list of their sales.

## Explanation
To complete the monetization loop, creators need to be able to see how their paid skills are performing. This requires a new page or a section in their existing dashboard that provides sales data. This first version will be a simple summary of earnings and a log of recent sales.

## Instructions
1.  **Create a new backend endpoint:**
    - Develop an endpoint like `/api/creators/dashboard` that is authenticated and returns the creator's sales data.
    - This endpoint should query the `user_skill_purchases` table for all purchases of skills belonging to agents owned by the logged-in user.
    - It should calculate total earnings (summing up `purchase_price`).
    - It should also return a list of recent transactions.

2.  **Create a new frontend page:**
    - Create a new HTML file, e.g., `dashboard.html`.
    - This page will fetch data from your new `/api/creators/dashboard` endpoint.
    - **UI elements:**
        - A summary section to display "Total Earnings."
        - A table or list to display "Recent Sales." The table should show the skill name, the agent name, the price it was sold for, and the date of the sale.

3.  **Data aggregation:**
    - In the backend endpoint, you'll need to join a few tables:
        - `user_skill_purchases` (the source of sales data).
        - `agent_identities` (to get the agent name and verify the owner).
        - `users` (to get the buyer's name, if you want to display it).

## Code Example (Backend Endpoint - `/api/creators/dashboard`)

```javascript
export default async function handler(req, res) {
  // ... authentication ...
  const userId = await getUserIdFromSession(req);

  // Get all agents owned by the user
  const agentsResult = await db.query('SELECT id FROM agent_identities WHERE user_id = $1', [userId]);
  const agentIds = agentsResult.rows.map(r => r.id);

  if (agentIds.length === 0) {
    return res.status(200).json({ total_earnings: 0, sales: [] });
  }

  // Get sales for those agents
  const salesResult = await db.query(
    `SELECT p.skill_name, p.purchase_price, p.purchased_at, a.name as agent_name
     FROM user_skill_purchases p
     JOIN agent_identities a ON p.agent_id = a.id
     WHERE p.agent_id = ANY($1)
     ORDER BY p.purchased_at DESC
     LIMIT 100`,
    [agentIds]
  );
  
  const totalEarnings = salesResult.rows.reduce((sum, row) => sum + Number(row.purchase_price), 0);

  res.status(200).json({
    total_earnings: totalEarnings / 1e6, // Convert to USDC
    sales: salesResult.rows,
  });
}
```

## Code Example (Frontend JavaScript for `dashboard.html`)

```javascript
async function loadDashboard() {
    const response = await fetch('/api/creators/dashboard');
    const data = await response.json();

    document.getElementById('total-earnings').textContent = `${data.total_earnings.toFixed(2)} USDC`;

    const salesList = document.getElementById('sales-list');
    salesList.innerHTML = data.sales.map(sale => `
        <tr>
            <td>${sale.agent_name}</td>
            <td>${sale.skill_name}</td>
            <td>${(sale.purchase_price / 1e6).toFixed(2)} USDC</td>
            <td>${new Date(sale.purchased_at).toLocaleDateString()}</td>
        </tr>
    `).join('');
}

loadDashboard();
```

## Verification
- Seed your database with some sample sales for agents owned by your test user.
- Navigate to the new `/dashboard` page.
- Verify that the total earnings are calculated and displayed correctly.
- Check that the list of recent sales is populated with the correct data.
- Ensure the page handles the case where a creator has no sales yet.
- Make sure only the creator's own sales are visible, not sales from other creators.
