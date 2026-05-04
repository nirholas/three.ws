# Prompt 10: Creator Dashboard UI for Earnings

## Objective
Create a new page in the creator dashboard to display total earnings, a list of recent transactions, and other relevant monetization analytics.

## Explanation
To create a complete ecosystem, creators must be able to track their sales. This prompt outlines the creation of a new "Earnings" tab in the dashboard that provides an overview of their revenue from skill sales.

## Instructions
1.  **Create New Dashboard Page:**
    *   Create a new HTML file: `dashboard/earnings.html`.
    *   Create a corresponding JavaScript file: `src/dashboard-earnings.js`.
    *   Add a link to this new page in the main dashboard navigation (`dashboard/index.html`).

2.  **Design the Earnings UI:**
    *   The `earnings.html` page should contain placeholders for:
        *   A "Total Revenue" card.
        *   A "Withdrawable Balance" card.
        *   A table or list for "Recent Sales".
        *   (Optional) A chart to show earnings over time.

3.  **Fetch Earnings Data:**
    *   In `src/dashboard-earnings.js`, make a request to a new API endpoint (to be created in the next prompt) that returns the creator's earnings data.
    *   Use the fetched data to populate the UI elements.

4.  **Structure the "Recent Sales" Table:**
    *   The table should display information for each purchase of the creator's skills.
    *   Columns should include: Skill Name, Agent Name, Date, Price, and Status.

## HTML Example (`dashboard/earnings.html`)

```html
<!-- Main content area -->
<div class="dashboard-content">
    <h2>Earnings</h2>

    <div class="stats-cards">
        <div class="card">
            <h4>Total Revenue</h4>
            <p id="total-revenue">$0.00</p>
        </div>
        <div class="card">
            <h4>Withdrawable Balance</h4>
            <p id="withdrawable-balance">$0.00</p>
            <button class="btn-secondary">Withdraw</button>
        </div>
    </div>

    <h3>Recent Sales</h3>
    <table id="sales-table">
        <thead>
            <tr>
                <th>Date</th>
                <th>Skill</th>
                <th>Agent</th>
                <th>Price</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            <!-- Rows will be inserted by JS -->
        </tbody>
    </table>
</div>

<script src="/src/dashboard-earnings.js" type="module"></script>
```
