# Prompt 20: Display Earnings in Creator Dashboard

## Objective
Fetch and display the creator's earnings summary and a list of their recent transactions in the "Earnings" tab of their dashboard.

## Explanation
This prompt brings the creator-facing part of the monetization feature to life. It involves building the backend endpoint to aggregate earnings data and then using that data to populate the UI components created in Prompt 17.

## Instructions
1.  **File to Edit (Backend):**
    *   Open the file for the `GET /api/dashboard/earnings` endpoint.

2.  **Implement Backend Logic:**
    *   **Authentication:** Ensure the user is authenticated.
    *   **Summary Metrics:**
        *   Write a SQL query to get the `SUM` of `gross_amount`, `platform_fee_amount`, and `net_amount` from the `skill_payment_earnings` table, `WHERE creator_id` matches the current user.
        *   Also, calculate the `withdrawable` amount by summing `net_amount` only for earnings where `payout_id` is `NULL`.
    *   **Recent Sales:**
        *   Write a query to get the 10 most recent records from `skill_payment_earnings` for the current creator, ordered by `created_at DESC`.
        *   Join with the `skill_payments` table to get additional details like the `skill_name`.
    *   **Response:** Return a JSON object containing `summary` and `recent_sales`.

3.  **File to Edit (Frontend):**
    *   Open the JavaScript for `agent-edit.html`.

4.  **Implement Frontend Rendering:**
    *   In the `initEarningsTab` function (from Prompt 17), use the data returned from the API to populate the UI.
    *   **Summary:** Update the text content of the summary cards (`#earnings-total-revenue`, etc.) with the formatted currency values.
    *   **Recent Sales:**
        *   Create a function `renderRecentSales(sales)`.
        *   If the `sales` array is empty, show a "No sales yet" message.
        *   If it has data, dynamically create a table or a list of `div`s to display each sale.
        *   Include columns for `Date`, `Skill Name`, `Gross Revenue`, and `Net Earnings`.
        *   Format dates and currency values to be human-readable.

## Code Example (Backend - `/api/dashboard/earnings.js`)

```javascript
// Inside the API handler

const user = await getAuthenticatedUser(req);

// Query for summary metrics
const summaryResult = await db('skill_payment_earnings')
  .where({ creator_id: user.id })
  .sum({
    total_revenue: 'gross_amount',
    net_earnings: 'net_amount'
  })
  .first();

const withdrawableResult = await db('skill_payment_earnings')
  .where({ creator_id: user.id, payout_id: null })
  .sum({ amount: 'net_amount' })
  .first();

const summary = {
  total_revenue: summaryResult.total_revenue || 0,
  net_earnings: summaryResult.net_earnings || 0,
  withdrawable: withdrawableResult.amount || 0,
};

// Query for recent sales
const recent_sales = await db('skill_payment_earnings as earn')
  .join('skill_payments as pay', 'earn.payment_id', 'pay.id')
  .where('earn.creator_id', user.id)
  .orderBy('earn.created_at', 'desc')
  .limit(10)
  .select(
    'earn.created_at',
    'pay.skill_name',
    'earn.gross_amount',
    'earn.net_amount',
    'earn.currency_mint'
  );

res.status(200).json({ summary, recent_sales });
```

## Code Example (Frontend - `agent-edit.html` script)

```javascript
function renderRecentSales(sales) {
    const container = document.getElementById('earnings-recent-sales');
    if (!sales || sales.length === 0) {
        container.innerHTML = '<p>No sales yet.</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'earnings-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Date</th>
                <th>Skill</th>
                <th>Gross</th>
                <th>Net</th>
            </tr>
        </thead>
        <tbody>
            ${sales.map(sale => `
                <tr>
                    <td>${new Date(sale.created_at).toLocaleDateString()}</td>
                    <td>${escapeHtml(sale.skill_name)}</td>
                    <td>${formatCurrency(sale.gross_amount, sale.currency_mint)}</td>
                    <td>${formatCurrency(sale.net_amount, sale.currency_mint)}</td>
                </tr>
            `).join('')}
        </tbody>
    `;
    container.innerHTML = '';
    container.appendChild(table);
}

function formatCurrency(amount, mint) {
    // Basic formatting, assuming 6 decimals for USDC
    const value = (amount / 1e6).toFixed(2);
    return `$${value} USDC`;
}
```
