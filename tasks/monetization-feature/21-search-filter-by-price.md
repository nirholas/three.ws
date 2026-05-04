---
status: not-started
---
# Prompt 21: Search & Filter by Price

**Status:** Not Started

## Objective
Add controls to the marketplace page that allow users to filter agents based on whether they have free or paid skills.

## Explanation
As the marketplace grows, users will need tools to find what they're looking for. Filtering by price is a fundamental discovery feature.

## Instructions
1.  **Backend: Modify the marketplace agent search/list endpoint (`/api/marketplace/agents`).**
    - The endpoint should accept a new query parameter, e.g., `price_filter=paid` or `price_filter=free`.
    - If `price_filter=paid`, the database query should only return agents that have at least one priced skill. This can be done with a `WHERE EXISTS` subquery checking `agent_skill_prices`.
    - If `price_filter=free`, return agents that have no priced skills.
2.  **Frontend: Add filter UI to `marketplace.html`.**
    - This could be a set of radio buttons or a dropdown: (All, Free, Paid).
3.  **Frontend: In `src/marketplace.js`, add an event listener to the filter controls.**
    - When a filter is changed, re-fetch the agent list from the API, appending the new query parameter.
    - Re-render the agent grid with the filtered results.

## Code Example (Frontend - Fetching with filter)
```javascript
// In marketplace.js
let currentPriceFilter = 'all'; // Default

document.getElementById('price-filters').addEventListener('change', (event) => {
    currentPriceFilter = event.target.value;
    fetchAgents();
});

async function fetchAgents() {
    let url = '/api/marketplace/agents';
    if (currentPriceFilter !== 'all') {
        url += `?price_filter=${currentPriceFilter}`;
    }
    
    const response = await fetch(url);
    const agents = await response.json();
    renderAgentGrid(agents);
}
```
