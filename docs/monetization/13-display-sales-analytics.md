# Prompt 13: Display Sales Analytics in Dashboard

## Objective
Fetch data from the new `/api/dashboard/analytics` endpoint and use it to populate the creator dashboard UI with dynamic charts and statistics.

## Explanation
This prompt brings the creator dashboard to life by replacing the static placeholder elements with real, live data from the backend.

## Instructions
1.  **Fetch Data on Page Load:**
    *   In the JavaScript file for the dashboard (`dashboard.js`), add a function that runs when the page loads.
    *   This function should make a `fetch` request to the `/api/dashboard/analytics` endpoint.

2.  **Populate Stat Cards:**
    *   Once the data is received, update the content of the summary cards for "Total Revenue" and "Total Sales" with the values from the API response.
    *   Format the revenue as a currency string (e.g., using `toLocaleString`).

3.  **Render the Chart:**
    *   Use a charting library like Chart.js to render the `salesOverTime` data.
    *   The X-axis should represent the date, and the Y-axis should represent the number of sales.
    *   Configure the chart to be a line chart for a clear visual representation of trends.

## Code Example (JavaScript - `dashboard.js`)
```javascript
import Chart from 'chart.js/auto';

async function loadAnalytics() {
    try {
        const response = await fetch('/api/dashboard/analytics');
        if (!response.ok) throw new Error('Failed to fetch analytics');
        const data = await response.json();

        // Populate stat cards
        document.getElementById('total-revenue').textContent = (data.totalRevenue / 1e6).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('total-sales').textContent = data.totalSales;

        // Render chart
        const ctx = document.getElementById('sales-chart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.salesOverTime.map(item => new Date(item.date).toLocaleDateString()),
                datasets: [{
                    label: 'Sales per Day',
                    data: data.salesOverTime.map(item => item.sales),
                    borderColor: '#4f46e5',
                    tension: 0.1
                }]
            }
        });
    } catch (error) {
        console.error('Error loading analytics:', error);
        // Display an error message in the UI
    }
}

document.addEventListener('DOMContentLoaded', loadAnalytics);
```
