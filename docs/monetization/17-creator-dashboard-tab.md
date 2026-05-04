# Prompt 17: Creator Dashboard Monetization Tab

## Objective
Create a new "Earnings" or "Monetization" tab in the agent creator's dashboard to serve as the central hub for managing paid skills and tracking revenue.

## Explanation
Creators need a dedicated space to view their sales performance, manage their payout settings, and see which of their skills are generating revenue. This prompt establishes the foundation for that space.

## Instructions
1.  **Identify Dashboard File:**
    *   Find the main file for the creator dashboard. This might be a file like `dashboard.html` or a route within a frontend framework. The file `agent-edit.html` has tabs, so it's a good candidate for adding a new one.

2.  **Add a New Tab:**
    *   Add a new "Earnings" tab to the tab list in `agent-edit.html`.
    *   Create the corresponding panel `div` that will be shown when the tab is active.
        ```html
        <!-- In the tab list -->
        <button class="edit-tab" data-tab="earnings" role="tab">Earnings</button>

        <!-- In the main content area -->
        <section class="edit-panel" id="panel-earnings" role="tabpanel" hidden>
            <!-- Content for the earnings panel will go here -->
        </section>
        ```

3.  **Basic Panel Structure:**
    *   Inside the `#panel-earnings` div, create the initial layout. This should include:
        *   A "Summary" section to display key metrics like "Total Revenue," "Platform Fees," and "Net Earnings."
        *   A "Recent Sales" section that will eventually contain a table or list of the latest skill purchases.
        *   A "Payouts" section for managing withdrawal settings and viewing payout history.

4.  **Backend Data Endpoint:**
    *   Create a new backend endpoint, e.g., `GET /api/dashboard/earnings`, that is authenticated for the current user.
    *   This endpoint should gather and return all the necessary data for this page:
        *   Aggregated earnings stats (total revenue, etc.).
        *   A list of the 10 most recent sales transactions.
        *   The creator's current payout wallet settings.

5.  **Frontend JavaScript:**
    *   In the JavaScript for `agent-edit.html`, add logic to handle the new "Earnings" tab.
    *   When the tab is clicked for the first time, make a call to the new `/api/dashboard/earnings` endpoint.
    *   Use the returned data to populate the sections you created in the HTML. For now, you can just display the raw data or simple placeholders.

## Code Example (Frontend - `agent-edit.html`)

```html
<!-- Inside the #panel-earnings section -->
<div class="earnings-summary">
    <div class="summary-card">
        <span class="label">Total Revenue</span>
        <span class="value" id="earnings-total-revenue">$0.00</span>
    </div>
    <div class="summary-card">
        <span class="label">Net Earnings</span>
        <span class="value" id="earnings-net">$0.00</span>
    </div>
    <div class="summary-card">
        <span class="label">Withdrawable</span>
        <span class="value" id="earnings-withdrawable">$0.00</span>
    </div>
</div>

<h3>Recent Sales</h3>
<div id="earnings-recent-sales">
    <p>No sales yet.</p>
</div>

<h3>Payout Settings</h3>
<div id="earnings-payouts">
    <!-- Payout UI will go here, from a later prompt -->
</div>
```

```javascript
// In the script for agent-edit.html

let earningsDataLoaded = false;
function initEarningsTab() {
    if (earningsDataLoaded) return;

    fetch('/api/dashboard/earnings')
        .then(res => res.json())
        .then(data => {
            document.getElementById('earnings-total-revenue').textContent = formatCurrency(data.summary.total_revenue);
            document.getElementById('earnings-net').textContent = formatCurrency(data.summary.net_earnings);
            document.getElementById('earnings-withdrawable').textContent = formatCurrency(data.summary.withdrawable);
            
            renderRecentSales(data.recent_sales);
            earningsDataLoaded = true;
        })
        .catch(err => {
            document.getElementById('panel-earnings').innerHTML = '<p class="error">Could not load earnings data.</p>';
        });
}

// In your tab switching logic, call initEarningsTab() when the 'earnings' tab is activated.
```
