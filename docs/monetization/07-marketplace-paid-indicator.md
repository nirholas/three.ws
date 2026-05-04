# Prompt 7: Visual Indicator for Paid Agents in Marketplace

## Objective
Add a visual badge or indicator to agent cards in the main marketplace grid to quickly show users which agents offer paid skills.

## Explanation
While filters are useful, users browsing the full list of agents should be able to identify monetized agents at a glance. A simple, clear visual indicator (like a "$" icon or a "Premium" badge) on the agent card will significantly improve scannability.

## Instructions
1.  **Modify Backend API:**
    *   The marketplace agent list endpoint (`/api/marketplace/agents`) needs to provide a flag indicating if an agent has any paid skills.
    *   When querying the list of agents, perform a `JOIN` or a subquery with `agent_skill_prices`.
    *   For each agent in the response, add a boolean field, such as `has_paid_skills: true` or `false`.
    *   *Optimization Note:* This is more efficient than the frontend making a separate request for each agent.

2.  **Update Frontend UI:**
    *   Open `src/marketplace.js`, and find the function that renders the grid of agent cards (e.g., `renderAgentGrid`).
    *   Inside the loop that creates each agent card, check for the new `agent.has_paid_skills` flag.
    *   If the flag is `true`, add an HTML element for the badge to the card's template.

3.  **Add CSS Styling:**
    *   Open `/marketplace.css` (or the relevant stylesheet).
    *   Add styles for your new badge to make it stand out. Position it in a corner of the agent card, for example.

## Code Example (Backend - SQL Query Idea)

```sql
-- A query to fetch agents and a flag indicating if they have priced skills
SELECT
  agents.*,
  (CASE WHEN COUNT(agent_skill_prices.skill_name) > 0 THEN TRUE ELSE FALSE END) AS has_paid_skills
FROM
  agents
LEFT JOIN
  agent_skill_prices ON agents.id = agent_skill_prices.agent_id
GROUP BY
  agents.id;
```

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Inside your function that renders the agent grid (e.g., renderAgentGrid)

function renderAgentCard(agent) {
    const card = document.createElement('div');
    card.className = 'agent-card';

    const premiumBadge = agent.has_paid_skills
        ? '<div class="premium-badge" title="Offers paid skills">⚡</div>'
        : '';

    card.innerHTML = `
        <div class="card-thumbnail" style="background-image: url('${escapeHtml(agent.thumbnail_url)}')">
            ${premiumBadge}
        </div>
        <div class="card-body">
            <h3 class="card-title">${escapeHtml(agent.name)}</h3>
            <p class="card-description">${escapeHtml(agent.description)}</p>
        </div>
    `;
    return card;
}
```

## Code Example (CSS - `/marketplace.css`)

```css
.agent-card .card-thumbnail {
  position: relative;
  /* ... existing styles ... */
}

.premium-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  background-color: rgba(253, 224, 71, 0.9); /* Same as --paid-bg but more opaque */
  color: #18181b; /* Dark text for contrast */
  padding: 1px 6px;
  font-size: 14px;
  font-weight: 700;
  border-radius: 6px;
  line-height: 1.4;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
```
