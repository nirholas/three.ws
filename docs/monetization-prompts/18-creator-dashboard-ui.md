# Prompt 18: Creator Dashboard - UI

## Objective
Build the frontend for the creator dashboard, visualizing the sales and earnings data provided by the backend APIs.

## Explanation
A visual dashboard is essential for creators to understand their performance at a glance. We will create a new page that consumes the creator dashboard APIs and presents the data using charts and tables.

## Instructions
1.  **Create the Dashboard Page:**
    *   Create a new HTML file, e.g., `creator-dashboard.html`.
    *   Create a corresponding JavaScript file, e.g., `src/creator-dashboard.js`.

2.  **Fetch and Display Key Stats:**
    *   On page load, make a request to the `GET /api/creator/dashboard/stats` endpoint.
    *   Display the returned stats (total revenue, total sales) in prominent "stat cards" at the top of the page.
    *   Remember to format the revenue from the smallest unit to a human-readable number.

3.  **Display Sales History:**
    *   Make a request to the `GET /api/creator/dashboard/sales-history` endpoint.
    *   Render the returned list of sales in a table. The table should include columns like "Date", "Skill Name", "Agent", "Price", and "Earnings".

4.  **Add a Chart (Optional but recommended):**
    *   Include a charting library like Chart.js or D3.
    *   Make a request to an endpoint that provides time-series data (e.g., `GET /api/creator/dashboard/revenue-over-time`). You may need to create this endpoint.
    *   Render a line or bar chart showing daily or weekly earnings.

## HTML Structure Example (`creator-dashboard.html`)

```html
<body>
  <h1>Creator Dashboard</h1>

  <div id="stats-grid">
    <div class="stat-card">
      <h4>Total Revenue</h4>
      <p id="total-revenue-stat">$0.00</p>
    </div>
    <div class="stat-card">
      <h4>Total Sales</h4>
      <p id="total-sales-stat">0</p>
    </div>
  </div>

  <div id="sales-chart-container">
    <canvas id="sales-chart"></canvas>
  </div>

  <div id="sales-history-container">
    <h3>Recent Sales</h3>
    <table id="sales-history-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Skill</th>
          <th>Earnings</th>
        </tr>
      </thead>
      <tbody>
        <!-- Rows will be injected by JavaScript -->
      </tbody>
    </table>
  </div>
</body>
```

## JavaScript Example (`src/creator-dashboard.js`)

```javascript
async function initDashboard() {
    // Fetch and display stats
    const statsRes = await fetch('/api/creator/dashboard/stats');
    const stats = await statsRes.json();
    document.getElementById('total-revenue-stat').textContent = `$${(stats.totalRevenue / 1e6).toFixed(2)}`;
    document.getElementById('total-sales-stat').textContent = stats.totalSales;

    // Fetch and render sales history table
    const historyRes = await fetch('/api/creator/dashboard/sales-history');
    const history = await historyRes.json();
    const tableBody = document.querySelector('#sales-history-table tbody');
    tableBody.innerHTML = history.sales.map(sale => `
        <tr>
            <td>${new Date(sale.date).toLocaleDateString()}</td>
            <td>${escapeHtml(sale.skillName)}</td>
            <td>$${(sale.earnings / 1e6).toFixed(2)}</td>
        </tr>
    `).join('');
    
    // Logic to initialize chart would go here
}

initDashboard();
```
