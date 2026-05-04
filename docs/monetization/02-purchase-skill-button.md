# Prompt 2: "Purchase Skill" Button

## Objective
Add a "Purchase" button to the agent detail page for skills that have a price. This button should be the primary call-to-action for monetizing skills.

## Explanation
Building on the previous prompt where we displayed the skill price, we now need to add an interactive element for users to initiate a purchase. The button should appear next to paid skills and should be disabled or hidden for skills the user already owns (though ownership functionality will be built in a later step).

## Instructions
1.  **Update the Frontend UI (`src/marketplace.js`):**
    *   In the `renderDetail` function, where you iterate over skills, add a conditional button.
    *   If a skill has a price (`skillPrices[name]`), render a `<button>` element.
    *   For now, we will not implement the click handler, but we should add placeholder classes and data attributes that we'll use later to wire up the payment flow.
    *   Give the button a class like `purchase-skill-btn`.
    *   Store the skill's name in a data attribute, e.g., `data-skill-name="${name}"`.

2.  **Style the Button (`marketplace.css`):**
    *   Add styling for the `purchase-skill-btn` to make it stand out.
    *   It should be visually appealing and clearly indicate that it's a purchase action. Use an accent color and consider adding an icon (e.g., a shopping cart or a lock icon).

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Inside renderDetail function, modifying the skills mapping

const skillPrices = a.skill_prices || {};
$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];

        let actionHtml = '';
        if (price) {
            const priceInUsdc = (price.amount / 1e6).toFixed(2);
            const priceBadge = `<span class="price-badge price-paid">${priceInUsdc} USDC</span>`;
            // For now, isOwned is a placeholder. We will implement this logic later.
            const isOwned = false; 
            if (isOwned) {
                actionHtml = '<span class="skill-owned">✓ Owned</span>';
            } else {
                actionHtml = `<button class="purchase-skill-btn" data-skill-name="${escapeHtml(name)}">Purchase</button>`;
            }
            return `<span class="skill-entry">${escapeHtml(name)}${priceBadge}${actionHtml}</span>`;
        } else {
            const freeBadge = `<span class="price-badge price-free">Free</span>`;
            return `<span class="skill-entry">${escapeHtml(name)}${freeBadge}</span>`;
        }
    }).join(' ')
    : '<div>This Agent has no skills defined.</div>';
```

## CSS Example (`marketplace.css`)

```css
.purchase-skill-btn {
  margin-left: 8px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 5px;
  background-color: var(--accent);
  color: #fff;
  border: 1px solid var(--accent);
  cursor: pointer;
  transition: background-color 0.2s;
}

.purchase-skill-btn:hover {
  filter: brightness(1.1);
}

.skill-owned {
  margin-left: 8px;
  font-size: 11px;
  color: #a7f3d0;
  font-weight: 600;
}
```
