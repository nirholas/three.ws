---
status: not-started
---

# Prompt 5: UI - Add "Buy Skill" Button

**Status:** Not Started

## Objective
Add a "Buy Skill" button to the agent detail page for paid skills that the user has not yet purchased.

## Explanation
To allow users to purchase skills, we need to provide a clear call-to-action. This task involves updating the marketplace UI to display a "Buy" button next to each paid skill. The button should only be visible to logged-in users and for skills they don't already own. We'll also need to know which skills the user has purchased.

## Instructions
1.  **Backend - Pass Purchase Data to Frontend:**
    - In the `/api/marketplace/agents/:id` endpoint (`api/marketplace/[action].js`), after fetching the agent details and skill prices, you need to check which of those skills the current user has purchased.
    - If a user is logged in, query the `user_skill_purchases` table for the current `user_id` and `agent_id`.
    - Add a `purchased_skills` array or set to the agent object in the API response, listing the names of the skills the user owns.

2.  **Frontend - Conditionally Render the "Buy" Button:**
    - In `src/marketplace.js`, within the `renderDetail` function, you now have access to the `purchased_skills` list.
    - In the loop that renders the skills, add a condition:
        - If a skill has a price and is *not* in the `purchased_skills` list, render a "Buy" button next to the price.
        - If the skill is free, show the "Free" badge.
        - If the skill is paid and already owned, you can show an "Owned" badge (this will be covered in a future prompt). For now, you can just omit the "Buy" button.
    - The "Buy" button should have `data-agent-id` and `data-skill-name` attributes to identify the skill when clicked.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Inside renderDetail function

const skillPrices = a.skill_prices || {};
const purchasedSkills = new Set(a.purchased_skills || []);

$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];
        let badge = `<span class="price-badge price-free">Free</span>`;
        if (price) {
            if (purchasedSkills.has(name)) {
                badge = `<span class="price-badge price-owned">Owned</span>`;
            } else {
                const priceInUSDC = (price.amount / 1e6).toFixed(2);
                badge = `
                    <span class="price-badge price-paid">${priceInUSDC} USDC</span>
                    <button class="buy-skill-btn" data-agent-id="${a.id}" data-skill-name="${name}">Buy</button>
                `;
            }
        }
        return `<span class="skill-entry">${escapeHtml(name)}${badge}</span>`;
    }).join(' ')
    : '<div>This Agent has no skills defined.</div>';
```

## CSS Example

Add these styles for the "Buy" button in `/marketplace.css`:

```css
.buy-skill-btn {
  margin-left: 8px;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  border: 1px solid #fde047;
  color: #fde047;
  background-color: transparent;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}

.buy-skill-btn:hover {
  background-color: rgba(253, 224, 71, 0.1);
  color: #fef08a;
}
```

## Verification
- Load an agent detail page for a logged-in user.
- Verify that paid skills you haven't purchased show a "Buy" button.
- Verify that free skills show the "Free" badge.
- Verify that (for now) purchased skills do not show a "Buy" button.
- Log out and verify that no "Buy" buttons are visible.
