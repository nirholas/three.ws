---
status: not-started
---

# Prompt 14: Creator Earnings Dashboard

**Status:** Not Started

## Objective
Create a simple dashboard for agent creators to see their total earnings and a history of their payouts.

## Explanation
To provide transparency and build trust, creators need to see how much they've earned from their paid skills. This task involves creating a new UI component, possibly in the "Monetization" tab or on a separate page, that fetches and displays earnings and payout data from the backend.

## Instructions
- [ ] **Create Backend Endpoints:**
    - [ ] You will need two new API endpoints:
        - `GET /api/earnings/summary`: Should return the user's total all-time earnings and their current balance pending payout.
        - `GET /api/earnings/payouts`: Should return a paginated list of the user's past payouts from the `payouts` table.
- [ ] **Build the Frontend UI:**
    - [ ] In the agent editor's "Monetization" tab (or a new page), add a new section for "Earnings".
    - [ ] Add display cards for "Total Revenue" and "Pending Payout".
    - [ ] Add a table to display the payout history.
- [ ] **Fetch and Render Data:**
    - [ ] On page load, call the new endpoints to get the data.
    - [ ] Populate the UI with the fetched data. Format dates and amounts nicely.

## Code Example (Conceptual UI)

```html
<!-- In the Monetization tab -->
<div id="earnings-dashboard">
  <h3>Your Earnings</h3>
  <div class="stats-grid">
    <div class="stat-card">
      <h4>Total Revenue</h4>
      <p id="total-revenue">$0.00</p>
    </div>
    <div class="stat-card">
      <h4>Pending Payout</h4>
      <p id="pending-payout">$0.00</p>
    </div>
  </div>

  <h4>Payout History</h4>
  <table id="payouts-table">
    <thead>
      <tr>
        <th>Date</th>
        <th>Amount</th>
        <th>Status</th>
        <th>Transaction</th>
      </tr>
    </thead>
    <tbody>
      <!-- Rows will be populated by JavaScript -->
    </tbody>
  </table>
</div>
```
