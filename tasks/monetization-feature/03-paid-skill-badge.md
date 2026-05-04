# Prompt 3: Paid Skill Badge in Marketplace List

## Objective
Add a visual indicator to the agent cards in the main marketplace grid (`/marketplace`) for agents that have one or more paid skills.

## Explanation
To increase the visibility of monetized agents and help users find premium content, we need to show a badge or icon on the agent cards in the main list view. This tells a user at a glance that an agent offers paid capabilities without needing to click into the detail page.

## Instructions

1.  **Modify the Backend API:**
    *   Locate the API endpoint that serves the agent list data (`/api/marketplace/agents`). This is in `api/marketplace/[action].js`.
    *   In the SQL query that fetches the list of agents, you need to add a check to see if each agent has any active, priced skills.
    *   A good way to do this is with a subquery or a `LEFT JOIN` and `COUNT`. An `EXISTS` subquery is often the most performant.
    *   The query should return a new boolean field for each agent, e.g., `has_paid_skills`.

2.  **Update the Frontend UI:**
    *   In `src/marketplace.js`, find the `renderCard` function.
    *   This function receives the agent object, which will now include the `has_paid_skills` boolean.
    *   Add a conditional block to the card's HTML template. If `has_paid_skills` is true, render a "Paid" or "$" badge.
    *   This is typically done in the `stats` section of the card, alongside views and forks.

## Code Example (Backend - SQL in `api/marketplace/[action].js`)

Here's how you can modify the agent list query to include the `has_paid_skills` flag.

```sql
-- Inside the handleList function's SQL query

SELECT
    ai.id, ai.name, ai.description, ai.category, -- ... other fields
    EXISTS (
        SELECT 1 FROM agent_skill_prices asp
        WHERE asp.agent_id = ai.id AND asp.is_active = true AND asp.amount > 0
    ) AS has_paid_skills
FROM
    agent_identities ai
-- ... rest of the query
```

## Code Example (Frontend - `src/marketplace.js`)

Modify the `renderCard` function to use the new flag.

```javascript
function renderCard(a) {
	const date = a.published_at ? formatDate(a.published_at) : '';
	const skills = (a.skills || []).length;
	return `<div class="market-card-agent" data-id="${a.id}">
		<div class="head">
			<div class="avatar">${initial(a.name)}</div>
			<div style="min-width:0;flex:1">
				<div class="title">${escapeHtml(a.name || 'Untitled')}</div>
				<div class="author">${escapeHtml(a.author_name || 'Anonymous')}</div>
			</div>
		</div>
		<div class="desc">${escapeHtml(a.description || '')}</div>
		<div class="stats">
			<span class="stat-pill">⊙ ${a.views_count || 0}</span>
			<span class="stat-pill">⑂ ${a.forks_count || 0}</span>
			${skills ? `<span class="stat-pill">▤ ${skills}</span>` : ''}
			${a.has_paid_skills ? `<span class="stat-pill paid-badge">$ Paid</span>` : ''}
		</div>
		<div class="footer">
			<span>${date}</span>
			<span class="cat-pill">${CATEGORY_LABELS[a.category] || a.category || ''}</span>
		</div>
	</div>`;
}
```

## CSS Example

Add styles for the new badge in `marketplace.css`.

```css
.stat-pill.paid-badge {
  color: #fde047;
  border: 1px solid rgba(253, 224, 71, 0.3);
  background-color: rgba(253, 224, 71, 0.1);
}
```
