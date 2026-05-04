# Prompt 11: Creator Dashboard UI

## Objective
Design and create the basic user interface for a new "Creator Dashboard" page, where agent creators can manage their monetization settings and view sales data.

## Explanation
A centralized dashboard is essential for creators to feel in control of their creations and revenue. This initial step focuses on building the static UI layout, which will be populated with dynamic data in subsequent tasks.

## Instructions
1.  **Create New HTML File:**
    *   Create a new file, `dashboard.html`.
    *   This page should be behind authentication, accessible only to logged-in users.

2.  **Design the Layout:**
    *   The layout should include:
        *   A main navigation/header shared with the rest of the site.
        *   A sidebar for dashboard-specific navigation (e.g., "Overview," "My Agents," "Analytics," "Settings").
        *   A main content area.

3.  **Build UI Components (Static):**
    *   In the "Overview" section, add placeholder components for:
        *   A summary card for total revenue.
        *   A summary card for total sales.
        *   A chart (you can use a library like Chart.js or just use a placeholder image for now) to show sales over time.
    *   In the "My Agents" section, add a placeholder for a table that will list the user's agents, along with stats like sales and revenue for each.

4.  **Add CSS:**
    *   Create a new CSS file, `dashboard.css`, and link it to your HTML.
    *   Add styles to create a clean, modern, and professional-looking dashboard layout.

## Code Example (HTML Structure - `dashboard.html`)
```html
<div class="dashboard-container">
  <aside class="dashboard-sidebar">
    <nav>
      <ul>
        <li><a href="#" class="active">Overview</a></li>
        <li><a href="#">My Agents</a></li>
        <li><a href="#">Analytics</a></li>
        <li><a href="#">Settings</a></li>
      </ul>
    </nav>
  </aside>
  <main class="dashboard-content">
    <h1>Overview</h1>
    <div class="stats-grid">
      <div class="stat-card">
        <h2>Total Revenue</h2>
        <p>$0.00</p>
      </div>
      <div class="stat-card">
        <h2>Total Sales</h2>
        <p>0</p>
      </div>
    </div>
    <div class="chart-container">
      <h2>Sales Over Time</h2>
      <!-- Placeholder for a chart -->
      <canvas id="sales-chart"></canvas>
    </div>
  </main>
</div>
```
