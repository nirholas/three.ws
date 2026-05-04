---
status: not-started
---

# Prompt 19: Creator Revenue Dashboard

## Objective
Create a new, dedicated "Creator Dashboard" page where agent owners can view their earnings from skill sales and subscriptions.

## Explanation
To empower creators, they need a clear and transparent view of their revenue. This dashboard is the central hub for creators to track their monetization success on the platform. This prompt focuses on the initial structure and UI of the dashboard.

## Instructions
1.  **Create a New HTML File:**
    *   Create a new file, `creator-dashboard.html`.
    *   This page should be protected and only accessible to logged-in users.

2.  **Design the Dashboard Layout:**
    *   The layout should include several key components:
        *   **Summary Stats:** A section at the top for key metrics like "Total Revenue," "30-Day Earnings," "Total Subscribers," and "Total Sales."
        *   **Revenue Chart:** A placeholder for a chart that will visualize earnings over time (e.g., daily or monthly).
        *   **Breakdown Section:** A section to show revenue broken down by source (e.g., "Skill Sales" vs. "Subscriptions").
        *   **Recent Transactions:** A table or list showing the most recent sales and subscription payments.
        *   **Top Performing Agents/Skills:** A list of the creator's agents or skills that are generating the most revenue.

3.  **Add Placeholders:**
    *   For this initial step, populate the dashboard with static HTML and placeholder values. The goal is to build the structure first.
    *   Use clear IDs for all elements that will be populated with dynamic data later.

## Code Example (HTML Structure for `creator-dashboard.html`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Creator Dashboard</title>
  <!-- Link to your standard CSS files -->
</head>
<body>
  <header>
    <!-- Your standard site header -->
  </header>
  <main class="container">
    <h1>Creator Dashboard</h1>

    <!-- Summary Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="label">Total Revenue (USDC)</div>
        <div class="value" id="total-revenue">$0.00</div>
      </div>
      <div class="stat-card">
        <div class="label">Last 30 Days</div>
        <div class="value" id="revenue-30-days">$0.00</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Subscribers</div>
        <div class="value" id="total-subscribers">0</div>
      </div>
      <div class="stat-card">
        <div class="label">Total Sales</div>
        <div class="value" id="total-sales">0</div>
      </div>
    </div>

    <!-- Revenue Chart -->
    <div class="panel">
      <div class="panel-header"><h2>Revenue Over Time</h2></div>
      <div class="panel-body">
        <div id="revenue-chart-container" class="empty">Chart loading...</div>
      </div>
    </div>

    <!-- Recent Transactions -->
    <div class="panel">
      <div class="panel-header"><h2>Recent Transactions</h2></div>
      <div class="panel-body no-pad">
        <table id="transactions-table">
          <thead>
            <tr><th>Date</th><th>Type</th><th>Agent/Skill</th><th>Amount</th><th>Status</th></tr>
          </thead>
          <tbody>
             <tr><td colspan="5" class="empty">No transactions yet.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </main>
</body>
</html>
```

**Next Steps:** The following prompts will focus on creating the backend APIs to populate this dashboard with real data.
