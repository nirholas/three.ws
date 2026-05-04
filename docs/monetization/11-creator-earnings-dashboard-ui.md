# Prompt 11: Creator Earnings Dashboard UI

## Objective
Design and implement a basic UI for the creator's "Earnings" dashboard, which will display their total revenue, the number of sales, and a list of recent transactions.

## Explanation
To provide value to creators, they need visibility into how their skills are performing. This dashboard is the central place for them to track their sales. This task involves creating the frontend components to display this data. The data itself will be fetched from a new backend endpoint (created in the next prompt).

## Instructions
1.  **Design the UI Layout:**
    *   Inside the `#earnings-container` in `agent-edit.html`, create the HTML structure for the earnings dashboard.
    *   Include "stat cards" for key metrics like "Total Revenue", "Total Sales", and "Balance".
    *   Add a table structure for a list of recent transactions, with columns for "Date", "Skill", "Price", and "Transaction ID".

2.  **Frontend JavaScript:**
    *   In `src/agent-edit.js`, create a function `renderEarningsDashboard`.
    *   This function will be called when the monetization tab is displayed.
    *   It will make a `fetch` call to a new backend endpoint (e.g., `/api/agents/[id]/earnings`) to get the sales data.
    *   Upon receiving the data, it will populate the stat cards and dynamically generate the rows for the transaction table.

3.  **Styling:**
    *   Add styles to `/public/agent-edit.css` to format the stat cards and the transaction table, ensuring it's readable and visually appealing.

## HTML Example (`agent-edit.html` inside `#earnings-container`)

```html
<div class="earnings-stats">
    <div class="stat-card">
        <h4>Total Revenue</h4>
        <p id="total-revenue-stat">$0.00</p>
    </div>
    <div class="stat-card">
        <h4>Total Sales</h4>
        <p id="total-sales-stat">0</p>
    </div>
    <div class="stat-card">
        <h4>Withdrawable Balance</h4>
        <p id="balance-stat">$0.00</p>
    </div>
</div>

<h4 class="table-header">Recent Sales</h4>
<div class="transactions-table">
    <div class="table-header-row">
        <div>Date</div>
        <div>Skill</div>
        <div>Price</div>
        <div>Transaction</div>
    </div>
    <div id="transactions-list">
        <!-- Rows will be injected here by JS -->
        <div class="table-empty-state">No sales yet.</div>
    </div>
</div>
```

## JavaScript Example (`src/agent-edit.js`)

```javascript
async function renderEarningsDashboard(agentId) {
    const response = await fetch(`/api/agents/${agentId}/earnings`);
    const data = await response.json();

    document.getElementById('total-revenue-stat').textContent = `$${(data.totalRevenue / 1e6).toFixed(2)}`;
    document.getElementById('total-sales-stat').textContent = data.totalSales;
    document.getElementById('balance-stat').textContent = `$${(data.balance / 1e6).toFixed(2)}`;

    const listContainer = document.getElementById('transactions-list');
    if (data.recentSales && data.recentSales.length > 0) {
        listContainer.innerHTML = data.recentSales.map(sale => `
            <div class="table-row">
                <div>${new Date(sale.purchased_at).toLocaleDateString()}</div>
                <div>${escapeHtml(sale.skill_name)}</div>
                <div>$${(sale.price / 1e6).toFixed(2)}</div>
                <div>
                    <a href="https://solscan.io/tx/${sale.transaction_signature}?cluster=devnet" target="_blank">
                        ${sale.transaction_signature.slice(0, 6)}...
                    </a>
                </div>
            </div>
        `).join('');
    } else {
        listContainer.innerHTML = '<div class="table-empty-state">No sales yet.</div>';
    }
}
```

## CSS Example (`/public/agent-edit.css`)

```css
.earnings-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 24px; }
.stat-card { background: #101018; padding: 16px; border-radius: 8px; border: 1px solid var(--border); }
.stat-card h4 { margin: 0 0 8px; color: var(--muted); font-size: 14px; }
.stat-card p { margin: 0; font-size: 24px; font-weight: 600; }
.table-header-row, .table-row { display: grid; grid-template-columns: 1fr 1fr 1fr 2fr; padding: 12px 8px; border-bottom: 1px solid var(--border); }
.table-header-row { font-weight: bold; color: var(--muted); }
.table-row a { color: var(--accent); text-decoration: none; }
.table-row a:hover { text-decoration: underline; }
```
