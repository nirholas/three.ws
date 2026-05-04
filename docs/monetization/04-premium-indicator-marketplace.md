---
status: not-started
---

# Prompt 4: Premium Indicator in Marketplace

## Objective
Add a "Premium" indicator or tag to agents that have at least one paid skill in the main marketplace list view.

## Explanation
To help users quickly identify monetized agents, we need a visual cue on the main marketplace page (`marketplace.html`). This makes premium agents stand out and signals that they offer advanced, paid functionality.

## Instructions
1.  **Modify the Backend API:**
    *   Locate the API endpoint that serves the list of agents for the marketplace (e.g., `/api/marketplace/agents`).
    *   The query should be modified to check if each agent has any associated entries in the `agent_skill_prices` table.
    *   A simple way is to use a `LEFT JOIN` and a `COUNT` or an `EXISTS` subquery.
    *   The API response for each agent object should now include a boolean flag, e.g., `has_paid_skills: true`.

2.  **Update the Frontend UI:**
    *   In the JavaScript file for the marketplace, locate the function that renders the list or grid of agent cards.
    *   When iterating through the agents, check for the `has_paid_skills` flag.
    *   If `true`, add a "Premium" badge or icon to the agent's card template.

## Code Example (Backend - SQL Query)

A possible SQL modification to get the flag:

```sql
SELECT
  agents.*,
  EXISTS (
    SELECT 1
    FROM agent_skill_prices
    WHERE agent_skill_prices.agent_id = agents.id
  ) AS has_paid_skills
FROM
  agents
-- ... add your WHERE clauses, LIMIT, OFFSET etc.
```

## Code Example (Frontend - Agent Card Rendering)

```javascript
// Inside the function that renders multiple agent cards
function renderAgentCard(agent) {
  const premiumBadge = agent.has_paid_skills
    ? `<span class="premium-badge">💎 Premium</span>`
    : '';

  return `
    <div class="agent-card">
      <div class="card-header">
        <span class="agent-name">${escapeHtml(agent.name)}</span>
        ${premiumBadge}
      </div>
      <div class="agent-description">${escapeHtml(agent.description)}</div>
      // ... rest of the card
    </div>
  `;
}
```

## CSS Example

Add these styles to the marketplace CSS file.

```css
.premium-badge {
  display: inline-block;
  margin-left: auto; /* Pushes it to the right in a flex container */
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 700;
  border-radius: 99px;
  color: #facc15; /* A gold/yellow color */
  background-color: rgba(250, 204, 21, 0.1);
  border: 1px solid rgba(250, 204, 21, 0.2);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
```
