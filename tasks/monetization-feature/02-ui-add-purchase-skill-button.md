---
status: completed
---
# Prompt 2: Add "Purchase Skill" Button to UI

**Status:** Not Started

## Objective
In the agent detail page, for skills that are not free and not yet owned by the user, display a "Purchase" button. This button will be the entry point for the skill acquisition flow.

## Explanation
Following the display of priced skills, the next logical step is to allow users to buy them. This task focuses on the UI component only. The button's action will be wired up in a subsequent task. We need to check if the user has already purchased the skill.

## Instructions
1.  **Modify the Backend API (`/api/marketplace/agents/:id`):**
    *   The API response should include information about which skills the *currently logged-in user* has already purchased. You might add a `purchased_skills` array of skill names to the agent object. You'll need to query your database for user entitlements.
2.  **Update the Frontend UI (`src/marketplace.js`):**
    *   In the `renderDetail` function, you now have access to `agent.skill_prices` and `agent.purchased_skills`.
    *   When rendering each skill, apply the following logic:
        *   If the skill has no price, show the "Free" badge.
        *   If the skill has a price and is in the `purchased_skills` array, show a "✅ Owned" badge.
        *   If the skill has a price and is NOT in the `purchased_skills` array, show the price badge and a "Purchase" button.
    *   The "Purchase" button should have `data-skill-name` and `data-agent-id` attributes to make it easy to handle the click event later.

## Code Example (`src/marketplace.js`)

```javascript
// Inside renderDetail function

const skillPrices = a.skill_prices || {};
const purchasedSkills = a.purchased_skills || [];

$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];
        let badge;

        if (price) {
            if (purchasedSkills.includes(name)) {
                badge = `<span class="price-badge price-owned">✓ Owned</span>`;
            } else {
                const priceInUSDC = (price.amount / 1e6).toFixed(2);
                badge = `<span class="price-badge price-paid">${priceInUSDC} USDC</span>` +
                        `<button class="purchase-btn" data-skill-name="${escapeHtml(name)}" data-agent-id="${a.id}">Purchase</button>`;
            }
        } else {
            badge = `<span class="price-badge price-free">Free</span>`;
        }
        return `<span class="skill-entry">${escapeHtml(name)}${badge}</span>`;
    }).join(' ')
    : '<div>This Agent has no skills defined.</div>';
```

## CSS Example (`/marketplace.css`)
```css
.purchase-btn {
  margin-left: 8px;
  padding: 3px 8px;
  border: 1px solid #fde047;
  background-color: transparent;
  color: #fde047;
  border-radius: 4px;
  cursor: pointer;
  font-size: 10px;
  font-weight: 600;
  transition: background-color 0.2s, color 0.2s;
}

.purchase-btn:hover {
  background-color: #fde047;
  color: #111;
}

.price-owned {
  color: #a7f3d0;
  background-color: rgba(52, 211, 153, 0.1);
}
```
