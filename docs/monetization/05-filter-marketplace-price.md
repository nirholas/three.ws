---
status: not-started
---

# Prompt 5: Filter Marketplace by Price

## Objective
Implement a filter control in the marketplace UI to allow users to view "All", "Free", or "Paid" agents.

## Explanation
Adding a filter enhances user experience by allowing them to narrow down the agent list based on their interest in free or premium offerings. This requires a small UI addition and logic to re-fetch the agent list with the selected filter.

## Instructions
1.  **Update the Frontend UI (`marketplace.html`):**
    *   Add a set of filter buttons or a dropdown menu to the marketplace page, typically above the agent list.
    *   The options should be "All", "Free", and "Paid".

2.  **Update the Backend API:**
    *   Modify the marketplace agent list endpoint (e.g., `/api/marketplace/agents`) to accept a query parameter, such as `pricing`.
    *   The backend should interpret `pricing=free`, `pricing=paid`, or no parameter (for "all").
    *   If `pricing=free`, the query should be adjusted to only return agents that do NOT have any entries in `agent_skill_prices`.
    *   If `pricing=paid`, the query should only return agents that HAVE at least one entry in `agent_skill_prices`.

3.  **Update Frontend JavaScript:**
    *   Add event listeners to the new filter controls.
    *   When a filter is selected, store the chosen value (e.g., 'free', 'paid').
    *   Trigger a function to re-fetch the agent list from the API, appending the new query parameter (e.g., `?pricing=paid`).
    *   The existing rendering logic should then automatically display the filtered list.
    *   Remember to handle pagination correctly if it's implemented.

## Code Example (HTML)

```html
<div class="marketplace-filters">
  <button class="filter-btn active" data-filter="all">All</button>
  <button class="filter-btn" data-filter="free">Free</button>
  <button class="filter-btn" data-filter="paid">Paid</button>
</div>
```

## Code Example (Frontend JavaScript)

```javascript
let currentPriceFilter = 'all';

document.querySelector('.marketplace-filters').addEventListener('click', (e) => {
  if (e.target.classList.contains('filter-btn')) {
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');
    currentPriceFilter = e.target.dataset.filter;
    fetchAndRenderAgents(); // Your main function to get and display agents
  }
});

async function fetchAndRenderAgents(page = 1) {
  let apiUrl = `/api/marketplace/agents?page=${page}`;
  if (currentPriceFilter !== 'all') {
    apiUrl += `&pricing=${currentPriceFilter}`;
  }
  // ... rest of the fetch and render logic
}
```

## Code Example (Backend - SQL Query Modification)

This demonstrates how to adjust the SQL query based on the filter.

```sql
-- Base Query
let query = `
  SELECT agents.*, EXISTS (...) AS has_paid_skills
  FROM agents
`;

// Filtering logic
if (req.query.pricing === 'paid') {
  query += ` WHERE EXISTS (SELECT 1 FROM agent_skill_prices p WHERE p.agent_id = agents.id)`;
} else if (req.query.pricing === 'free') {
  query += ` WHERE NOT EXISTS (SELECT 1 FROM agent_skill_prices p WHERE p.agent_id = agents.id)`;
}

// Add ordering, limit, offset, etc.
// ...
```
