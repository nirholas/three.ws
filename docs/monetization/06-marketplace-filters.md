# Prompt 6: Marketplace Filters for Paid/Free Skills

## Objective
Add filtering options to the marketplace page (`marketplace.html`) to allow users to easily discover agents with paid skills, free skills, or both.

## Explanation
As the marketplace grows, users will need tools to find the agents that fit their needs and budget. A simple filter for monetization status (Free vs. Paid) is a crucial discovery feature.

## Instructions
1.  **Modify Marketplace UI:**
    *   Open `marketplace.html`.
    *   Locate the filtering section of the page (where category or search filters might already exist).
    *   Add a new set of controls for filtering by price. A dropdown menu or a set of radio buttons would work well.
        *   Options: "All", "Paid Skills", "Free Skills".

2.  **Update Frontend JavaScript:**
    *   Open `src/marketplace.js` (or wherever the marketplace frontend logic resides).
    *   Modify the function that fetches the list of agents (e.g., `searchAgents` or `loadAgents`).
    *   This function should now read the value of your new price filter.
    *   Pass the selected filter value as a query parameter in the API request to the backend. For example:
        *   `/api/marketplace/agents?pricing=paid`
        *   `/api/marketplace/agents?pricing=free`
        *   `/api/marketplace/agents` (for "All")

3.  **Update Backend API:**
    *   Open the backend file that handles agent listings for the marketplace (e.g., `api/marketplace/agents.js`).
    *   The endpoint should now check for the `pricing` query parameter.
    *   **If `pricing=paid`:** Modify your database query to only return agents that have at least one entry in the `agent_skill_prices` table. This may require a `JOIN` or a subquery.
    *   **If `pricing=free`:** Modify your query to only return agents that have zero entries in the `agent_skill_prices` table. This may require a `LEFT JOIN` and a `WHERE ... IS NULL` check.
    *   **If the parameter is absent:** Return all agents as before.

## Code Example (Frontend - `marketplace.html`)

```html
<!-- Add to the filter section in marketplace.html -->
<div class="filter-group">
    <label for="filter-pricing">Pricing</label>
    <select id="filter-pricing">
        <option value="all">All</option>
        <option value="paid">Paid Skills</option>
        <option value="free">Free Skills</option>
    </select>
</div>
```

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Inside the function that triggers the agent search
function fetchAndRenderAgents() {
    const pricingFilter = document.getElementById('filter-pricing').value;
    
    const queryParams = new URLSearchParams();
    if (pricingFilter !== 'all') {
        queryParams.set('pricing', pricingFilter);
    }
    // ... add other filters like search query, category ...

    const url = `/api/marketplace/agents?${queryParams.toString()}`;
    
    fetch(url)
        .then(res => res.json())
        .then(data => {
            renderAgentGrid(data.agents);
        });
}
```

## Code Example (Backend - SQL Query Idea)

```sql
-- For pricing=paid
SELECT agents.* FROM agents
INNER JOIN agent_skill_prices ON agents.id = agent_skill_prices.agent_id
GROUP BY agents.id;

-- For pricing=free
SELECT agents.* FROM agents
LEFT JOIN agent_skill_prices ON agents.id = agent_skill_prices.agent_id
WHERE agent_skill_prices.agent_id IS NULL;
```
