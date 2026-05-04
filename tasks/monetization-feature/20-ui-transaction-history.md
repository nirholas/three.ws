---
status: not-started
---
# Prompt 20: User Transaction History UI

**Status:** Not Started

## Objective
Create a "Transaction History" page for users to see a list of their past skill purchases.

## Explanation
Users need a way to track their spending and see a record of the skills they've acquired. This adds transparency and helps with user account management.

## Instructions
1.  **Backend: Create a new endpoint `GET /api/users/me/purchases`.**
    - The endpoint must be authenticated.
    - Query the `skill_purchases` table for all records matching the logged-in `user_id`.
    - For each record, join with the `skills` and `agents` tables to get their names.
    - Return an array of purchase objects.
2.  **Frontend: Create a new page `public/purchase-history.html`.**
3.  **Create a script `src/purchase-history.js`.**
4.  **Fetch data from the new endpoint on page load.**
5.  **Render the data as a table or a list.**
    - Each row should display: Skill Name, Agent Name it was purchased for, Price, and Purchase Date.
    - Include a link to the transaction signature on a block explorer like Solscan or Solana Explorer.

## Code Example (Frontend - Rendering a history row)
```javascript
// purchases is the array from the API
const historyHtml = purchases.map(p => `
    <tr>
        <td>${p.skill_name}</td>
        <td>${p.agent_name}</td>
        <td>${(p.purchase_amount / 1e6).toFixed(2)} USDC</td>
        <td>${new Date(p.purchased_at).toLocaleDateString()}</td>
        <td>
            <a href="https://solscan.io/tx/${p.transaction_signature}" target="_blank">View on Solscan</a>
        </td>
    </tr>
`).join('');

document.getElementById('history-table-body').innerHTML = historyHtml;
```
