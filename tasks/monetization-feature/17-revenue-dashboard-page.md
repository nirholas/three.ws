# Prompt 17: Creator Revenue Dashboard Page

## Objective
Create a new "Revenue" tab and page within the main user dashboard area (`/dashboard`) for agent creators to track their earnings.

## Explanation
Creators need a central place to see how much money their agents are making. We will add a new section to the existing dashboard for this purpose. This first step involves creating the basic page structure, adding the navigation tab, and ensuring it can be routed to. The content of the dashboard will be filled in by later prompts.

## Instructions
1.  **Locate Dashboard Files:**
    *   The main dashboard files are likely `public/dashboard/dashboard.js` and a corresponding HTML file (e.g., `pump-dashboard.html` or similar - check file list). You will need to modify both.

2.  **Add Navigation Tab:**
    *   In the HTML file for the dashboard, find the navigation menu/sidebar.
    *   Add a new link/tab for "Revenue." Give it a `data-tab="revenue"` attribute to work with the existing JavaScript-based routing. Choose a suitable icon.

3.  **Add a Page Container:**
    *   In the same HTML file, in the main content area, add a new container `div` for the revenue page. It should have `id="page-revenue"` and be hidden by default (`style="display:none"`), consistent with the other dashboard pages.

4.  **Implement JavaScript Routing:**
    *   In `public/dashboard/dashboard.js`, find the routing logic. There should be a map or switch statement that links `data-tab` values to rendering functions.
    *   Add a new entry for `'revenue'` that maps to a new function, `renderRevenue`.

5.  **Create the `renderRevenue` Function:**
    *   Create a new `async function renderRevenue(root)` in `dashboard.js`.
    *   For now, this function should just render the basic structure of the revenue page inside the `root` element (which will be the main content area).
    *   Include a title, a brief description, and placeholders for where the stats and transaction list will go.

## Code Example (HTML - in dashboard file)

```html
<!-- In the sidebar/nav menu -->
<a href="#" data-tab="revenue"><span class="icon">💰</span> Revenue</a>

<!-- In the main content area, with the other pages -->
<div class="content page" id="page-revenue" style="display:none">
    <!-- Content will be rendered here by dashboard.js -->
</div>
```

## Code Example (JavaScript - `public/dashboard/dashboard.js`)

```javascript
// --- In the tabs mapping object ---
const tabs = {
	avatars: renderAvatars,
	// ... other tabs
	revenue: renderRevenue, // Add this line
	account: renderAccount,
};

// --- Add the new rendering function ---
async function renderRevenue(root) {
    root.innerHTML = `
        <div class="page-header">
            <h1>Revenue</h1>
            <p class="sub">Track your earnings from paid agent skills.</p>
        </div>
        <div id="revenue-content">
            <div class="panel">
                <div class="panel-body">
                    <div class="empty">
                        <div class="icon">📈</div>
                        Loading revenue data...
                    </div>
                </div>
            </div>
        </div>
    `;

    // In the next prompts, we will fetch data and fill this content.
    // e.g., loadRevenueStats();
    // e.g., loadRevenueEvents();
}
```
With these changes, users will be able to click on the "Revenue" tab and see the basic placeholder page, setting the stage for the data-rich components to come.
