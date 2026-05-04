---
status: not-started
---

# Prompt 5: Frontend - Handle Price Loading States

## Objective
Improve the user experience on the agent detail page by showing a loading state while skill prices are being fetched.

## Explanation
The skill prices are fetched from the database and may not be available at the exact moment the agent details are first rendered. To prevent a jarring UI update where prices suddenly appear, we should display a placeholder or loading indicator. This provides a smoother experience and gives users feedback that content is being loaded.

## Instructions
1.  **Modify the API Response:**
    *   Ensure the `/api/marketplace/agents/:id` endpoint returns the agent data immediately, even if the `skill_prices` query is still running. The `skill_prices` field can be initially `null` or an empty object.

2.  **Update the Frontend Rendering Logic:**
    *   In `src/marketplace.js` within the `renderDetail` function, add a check for the `skill_prices` field.
    *   If `skill_prices` is not yet present, render a loading state for the skill badges.
    *   Once the full agent data with prices is fetched, re-render the skill list with the correct prices. This can be achieved by calling `renderDetail` again or by having a dedicated function to update just the skill badges.

## Code Example (UI Loading State in `src/marketplace.js`)

```javascript
// A simple loading badge component/function
function LoadingBadge() {
    return `<span class="price-badge price-loading">...</span>`;
}

function renderSkills(skillsArr, skillPrices) {
    const skillsEl = $('d-skills');
    if (!skillsEl) return;

    // Check for null to indicate loading, vs. {} for an agent with no priced skills
    const isLoading = skillPrices === null;

    skillsEl.innerHTML = skillsArr.length
        ? skillsArr.map((s) => {
            const name = typeof s === 'string' ? s : (s.name || '');
            const price = isLoading ? null : (skillPrices || {})[name];
            const badge = isLoading ? LoadingBadge() : PriceBadge(price);
            return `<span class="skill-entry">${escapeHtml(name)}${badge}</span>`;
        }).join(' ')
        : '<div>This Agent has no skills defined.</div>';
}

// In the main part of renderDetail
async function renderDetail(id) {
    // ...
    // Initial render with loading state
    renderSkills(agent.skills, null);

    // Fetch full data
    const agentWithPrices = await fetchAgentWithPrices(id); // Your data fetching logic
    // Re-render with prices
    renderSkills(agentWithPrices.skills, agentWithPrices.skill_prices);
}
```

### CSS for Loading State

Add to `/public/marketplace.css`:

```css
.price-loading {
  color: #9ca3af;
  background-color: #374151;
  animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: .5;
  }
}
```
