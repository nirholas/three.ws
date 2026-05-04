---
status: not-started
---

# Prompt 23: Frontend - Creator Analytics Dashboard

## Objective
Provide creators with a dedicated analytics dashboard to help them understand their sales performance and identify trends.

## Explanation
Beyond a simple list of sales, a true analytics dashboard empowers creators with visual data. Charts and key metrics can help them understand which of their skills are most popular, what times they see the most sales, and their overall growth trajectory. This helps them make better decisions and ultimately leads to more high-quality content on your platform.

## Instructions
1.  **Choose a Charting Library:**
    *   Select a JavaScript charting library to easily create interactive charts. Good options include Chart.js, D3.js, or ECharts.
    *   Install your chosen library: `npm install chart.js`.

2.  **Update the Backend Earnings Endpoint:**
    *   Modify `/api/users/earnings`.
    *   In addition to the transaction list, the API should return data pre-aggregated for charts. For example, a time-series of sales per day for the last 30 days.
    *   `SELECT DATE_TRUNC('day', created_at) AS day, SUM(price_usd) AS daily_revenue FROM royalty_ledger WHERE ... GROUP BY day ORDER BY day;`
    *   Also, add an aggregation for sales by skill:
    *   `SELECT skill_name, COUNT(*) as sales_count, SUM(price_usd) as total_revenue FROM ... GROUP BY skill_name;`

3.  **Enhance the `earnings.html` UI:**
    *   Add `<canvas>` elements to your earnings page where the charts will be rendered.
    *   Create sections for "Sales Over Time" and "Top Performing Skills".

4.  **Implement Frontend Charting Logic:**
    *   In `src/earnings.js`, after fetching the data from the API:
    *   Initialize a new chart using the canvas element for "Sales Over Time". Use the time-series data from the API to populate the chart's labels (dates) and data (revenue).
    *   Create a second chart (e.g., a bar or pie chart) for "Top Performing Skills". Use the skill aggregation data to show which skills are generating the most sales or revenue.

## Chart.js Example (`src/earnings.js`)

```javascript
import Chart from 'chart.js/auto';

// After fetching the API data which includes a 'sales_over_time' array
const data = await response.json();

const ctx = document.getElementById('sales-over-time-chart').getContext('2d');
new Chart(ctx, {
  type: 'line',
  data: {
    labels: data.sales_over_time.map(d => new Date(d.day).toLocaleDateString()),
    datasets: [{
      label: 'Daily Revenue (USD)',
      data: data.sales_over_time.map(d => d.daily_revenue),
      borderColor: 'rgba(52, 211, 153, 1)',
      tension: 0.1,
      fill: true,
    }]
  },
  options: {
    // ... chart options
  }
});
```
