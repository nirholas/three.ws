---
status: not-started
---

# Prompt 22: Creator Revenue Charts

## Objective
Integrate a charting library into the Creator Dashboard to visually represent revenue data.

## Explanation
Visual data is much easier to understand than raw numbers. Adding a chart to the Creator Dashboard will provide creators with a clear and immediate understanding of their performance over time.

## Instructions
1.  **Choose a Charting Library:**
    *   Select a suitable JavaScript charting library. Good options include:
        *   **Chart.js:** Simple, popular, and easy to get started with.
        *   **ApexCharts:** Offers more interactive and visually polished charts.
        *   **D3.js:** Extremely powerful and customizable, but with a steeper learning curve.
    *   For this task, Chart.js is a great choice.

2.  **Include the Library:**
    *   Add the chosen library to `creator-dashboard.html`, either via a CDN script tag or by installing it as an npm package.

3.  **Implement Frontend Charting Logic:**
    *   Create a new JavaScript file for the dashboard, e.g., `src/creator-dashboard.js`.
    *   Write a function, `renderRevenueChart(data)`, that will be responsible for drawing the chart.
    *   On page load, fetch the data from the `/api/creators/me/revenue-chart` endpoint created previously.
    *   Pass the fetched data to your `renderRevenueChart` function.
    *   Inside the function, process the data into the format required by the charting library (e.g., arrays for `labels` and `datasets`).
    *   Create a new chart instance, targeting the canvas element you created in the dashboard's HTML.
    *   Configure the chart's appearance (e.g., line chart, bar chart, colors, tooltips).

## Code Example (HTML in `creator-dashboard.html`)

```html
<!-- Include Chart.js from a CDN -->
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

<!-- ... in your main content ... -->
<div class="panel">
  <div class="panel-header">
    <h2>Revenue Over Time</h2>
    <select id="chart-range-selector">
      <option value="7d">Last 7 Days</option>
      <option value="30d" selected>Last 30 Days</option>
      <option value="12m">Last 12 Months</option>
    </select>
  </div>
  <div class="panel-body">
    <canvas id="revenue-chart-canvas"></canvas>
  </div>
</div>
```

## Code Example (JavaScript in `src/creator-dashboard.js`)

```javascript
let revenueChart = null; // To hold the chart instance

document.addEventListener('DOMContentLoaded', () => {
    loadChartData('30d');
    document.getElementById('chart-range-selector').addEventListener('change', (e) => {
        loadChartData(e.target.value);
    });
});

async function loadChartData(range) {
    try {
        const response = await fetch(`/api/creators/me/revenue-chart?range=${range}`);
        const data = await response.json();
        renderRevenueChart(data);
    } catch (e) {
        document.getElementById('revenue-chart-canvas').innerHTML = 'Could not load chart data.';
    }
}

function renderRevenueChart(apiData) {
    const ctx = document.getElementById('revenue-chart-canvas').getContext('2d');

    // Process data for Chart.js
    const labels = apiData.map(d => new Date(d.date).toLocaleDateString());
    const revenueData = apiData.map(d => d.revenue);

    // Destroy previous chart instance if it exists
    if (revenueChart) {
        revenueChart.destroy();
    }

    revenueChart = new Chart(ctx, {
        type: 'line', // Or 'bar'
        data: {
            labels: labels,
            datasets: [{
                label: 'Revenue (USDC)',
                data: revenueData,
                borderColor: '#00ff41',
                backgroundColor: 'rgba(0, 255, 65, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: '#888' },
                    grid: { color: '#222' }
                },
                x: {
                    ticks: { color: '#888' },
                    grid: { color: '#222' }
                }
            }
        }
    });
}
```
