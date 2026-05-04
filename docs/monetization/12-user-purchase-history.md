---
status: not-started
---

# Prompt 12: User Purchase History

## Objective
Create a new section in the user's profile or dashboard page to display a history of their skill purchases.

## Explanation
Users should have a record of their transactions and purchased items. A purchase history page provides transparency and allows users to see the value they've received from the platform.

## Instructions
1.  **Create a Backend Endpoint for Purchase History:**
    *   Create a new authenticated API endpoint, e.g., `GET /api/users/me/purchase-history`.
    *   This endpoint should query the `user_unlocked_skills` table for the current user.
    *   It should join with the `agents` and `agent_skill_prices` tables to retrieve richer data for each entry, such as the agent's name, the skill name, the price paid, the currency, the transaction signature, and the purchase date.
    *   The endpoint should support pagination (e.g., using `LIMIT` and `OFFSET`).

2.  **Create a New Frontend Page/Section:**
    *   In the user's main dashboard or profile area, add a new tab or link for "Purchase History".
    *   Create the HTML structure for this section, which will primarily be a table to display the history.
    *   The table should have columns for: Agent, Skill, Date, Price, and a link to the transaction on a block explorer.

3.  **Implement Frontend Logic:**
    *   When the user navigates to the purchase history section, a JavaScript function should be called to fetch the data from the new API endpoint.
    *   The script should then dynamically render the rows of the table using the fetched data.
    *   Format the data for display (e.g., format dates, format prices, create the block explorer link).
    *   If you implemented pagination, add "Next" and "Previous" buttons.

## Code Example (Backend - SQL Query)

```sql
SELECT
  u.skill_name,
  u.transaction_signature,
  u.created_at AS purchase_date,
  a.name AS agent_name,
  p.amount,
  p.currency_mint
FROM
  user_unlocked_skills u
JOIN
  agents a ON u.agent_id = a.id
LEFT JOIN
  agent_skill_prices p ON u.agent_id = p.agent_id AND u.skill_name = p.skill_name
WHERE
  u.user_id = $1
ORDER BY
  u.created_at DESC
LIMIT 20 OFFSET $2;
```

## Code Example (HTML Structure)

```html
<!-- In user-dashboard.html or similar -->
<div id="purchase-history-section">
  <h2>Purchase History</h2>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Agent</th>
          <th>Skill</th>
          <th>Price</th>
          <th>Transaction</th>
        </tr>
      </thead>
      <tbody id="purchase-history-table-body">
        <!-- Rows will be rendered here -->
      </tbody>
    </table>
  </div>
  <div class="pagination-controls">
    <button id="history-prev-btn">Previous</button>
    <button id="history-next-btn">Next</button>
  </div>
</div>
```

## Code Example (Frontend JavaScript)

```javascript
async function renderPurchaseHistory(page = 1) {
  const tbody = document.getElementById('purchase-history-table-body');
  try {
    const response = await fetch(`/api/users/me/purchase-history?page=${page}`);
    const history = await response.json();

    if (history.length === 0 && page === 1) {
      tbody.innerHTML = '<tr><td colspan="5">No purchases yet.</td></tr>';
      return;
    }

    tbody.innerHTML = history.map(item => {
      const price = item.amount ? `${(item.amount / 1e6).toFixed(2)} USDC` : 'N/A';
      const explorerUrl = `https://solscan.io/tx/${item.transaction_signature}`;
      return `
        <tr>
          <td>${new Date(item.purchase_date).toLocaleDateString()}</td>
          <td>${escapeHtml(item.agent_name)}</td>
          <td>${escapeHtml(item.skill_name)}</td>
          <td>${price}</td>
          <td><a href="${explorerUrl}" target="_blank" rel="noopener">View on Solscan</a></td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="5">Failed to load purchase history.</td></tr>';
    console.error(error);
  }
}
```
