---
status: not-started
---

# Prompt 7: Frontend - Creator Earnings Dashboard

## Objective
Create a dedicated page for creators to view their total earnings, pending payments, and a history of their sales.

## Explanation
To empower creators, they need a transparent view of their monetization performance. This dashboard will serve as their financial hub, providing key metrics and a detailed breakdown of every sale, which builds trust and encourages them to create more premium content.

## Instructions
1.  **Create New Frontend Files:**
    *   Create a new HTML file: `earnings.html`.
    *   Create a new JavaScript module: `src/earnings.js`.
    *   Link the script in the HTML file: `<script type="module" src="/src/earnings.js"></script>`.

2.  **Design the UI in `earnings.html`:**
    *   Add a main title, e.g., "Creator Earnings".
    *   Create summary boxes for "Total Revenue", "Pending Payout", and "Total Sales".
    *   Add a table element with a `<thead>` for the sales history. Columns should include: "Date", "Skill Name", "Agent Name", "Price", and "Status" (e.g., Pending, Paid).
    *   The table should have a `<tbody>` with a unique ID for dynamically inserting rows.

3.  **Implement Frontend Logic in `src/earnings.js`:**
    *   On page load, make a GET request to a new `/api/users/earnings` endpoint.
    *   Process the JSON response.
    *   Populate the summary boxes with the aggregate data.
    *   Iterate through the sales history array. For each sale, create a `<tr>` element and insert it into the table body.
    *   Format dates and currency values for readability.

## HTML Structure Example (`earnings.html`)

```html
<main>
  <h1>Creator Earnings</h1>
  <div class="summary-cards">
    <div class="card">
      <h2>Total Revenue</h2>
      <p id="total-revenue">$0.00</p>
    </div>
    <div class="card">
      <h2>Pending Payout</h2>
      <p id="pending-payout">$0.00</p>
    </div>
  </div>
  <h2>Sales History</h2>
  <table id="sales-table">
    <thead>
      <tr>
        <th>Date</th>
        <th>Skill</th>
        <th>Price</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody id="sales-tbody">
      <!-- Rows will be inserted here by JavaScript -->
    </tbody>
  </table>
</main>
<script type="module" src="/src/earnings.js"></script>
```
