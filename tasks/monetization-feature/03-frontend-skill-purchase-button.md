---
status: not-started
---

# Prompt 3: Frontend - Add Skill Purchase Button

## Objective
Add a "Purchase" button for priced skills on the agent detail page to enable users to initiate the buying process.

## Explanation
With skill prices now displayed, the next step is to provide a clear call-to-action for users to purchase them. This involves replacing the static "Free" or price badge with an interactive "Purchase" button for paid skills. This button will be the entry point for the payment flow.

## Instructions
1.  **Locate the Rendering Logic:**
    *   Open `src/marketplace.js` and find the `renderDetail` function.
    *   Identify the section where skill badges are currently rendered.

2.  **Conditionally Render a Button:**
    *   Modify the loop that iterates through the agent's skills.
    *   For each skill, check if a price exists in the `a.skill_prices` object.
    *   If a price exists, instead of just a text badge, render a `<button>` element.
    *   If the skill is free, continue to show the "Free" badge.

3.  **Embed Data in the Button:**
    *   The purchase button must contain the necessary information to initiate a transaction.
    *   Add `data-*` attributes to the button to store the `skill_name` and `agent_id`.

## Code Example (`src/marketplace.js`)

```javascript
// Inside renderDetail function, modify the skill mapping

const skillPrices = a.skill_prices || {};
$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];

        const badge = price
            ? `<button class="purchase-btn" data-skill="${escapeHtml(name)}" data-agent="${a.id}">
                   Purchase for ${(price.amount / 1e6).toFixed(2)} USDC
               </button>`
            : `<span class="price-badge price-free">Free</span>`;

        return `<span class="skill-entry">${escapeHtml(name)}${badge}</span>`;
    }).join(' ')
    : '<div>This Agent has no skills defined.</div>';
```

## CSS Example (`/marketplace.css`)

Add styles for the new purchase button.

```css
.purchase-btn {
  margin-left: 8px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid #fde047;
  color: #fde047;
  background-color: rgba(253, 224, 71, 0.1);
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}

.purchase-btn:hover {
  background-color: #fde047;
  color: #111827;
}
```
