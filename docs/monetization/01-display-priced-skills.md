---
status: not-started
---

# Prompt 1: Display Priced Skills in Marketplace

## Objective
Modify the agent detail page in the marketplace to visually distinguish between free and paid skills, and display the price for paid skills.

## Explanation
Currently, the agent detail page lists all skills uniformly. To begin building our monetization feature, users need to be able to see which skills are premium and how much they cost. This involves fetching pricing data along with agent details and updating the UI to render prices and a premium indicator.

## Instructions
1.  **Modify the Backend API:**
    *   Locate the API endpoint that serves the agent detail data (`/api/marketplace/agents/:id`). You can find this in `api/marketplace/[action].js`.
    *   When fetching agent details, also query the `agent_skill_prices` table to get the prices for the agent's skills.
    *   Join this pricing data with the agent details response. The agent object should now have a `skill_prices` map or object, like `{ "skill_name": { "amount": 1000000, "currency_mint": "EPjFWdd..." } }`.

2.  **Update the Frontend UI:**
    *   In `src/marketplace.js`, find the `renderDetail` function.
    *   This function receives the agent object, which now includes `skill_prices`.
    *   Inside the loop that renders the skills (`d-skills` element), check if a price exists for the current skill.
    *   If a price exists, render a price badge next to the skill name. Convert the amount from lamports (or the smallest unit) to a human-readable format (e.g., 1,000,000 lamports = 1 USDC).
    *   Style the price badge to be visually distinct.

## Code Example (Frontend - `src/marketplace.js`)

Here's how you might modify the skill rendering part within the `renderDetail` function:

```javascript
// Inside renderDetail function

const skillPrices = a.skill_prices || {};
$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];
        const badge = price
            ? `<span class="price-badge price-paid">${(price.amount / 1e6).toFixed(2)} USDC</span>`
            : `<span class="price-badge price-free">Free</span>`;
        return `<span class="skill-entry">${escapeHtml(name)}${badge}</span>`;
    }).join(' ')
    : '<div>This Agent has no skills defined.</div>';
```

## CSS Example

Add these styles to `/marketplace.css` to make the price badges look good.

```css
.price-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  vertical-align: middle;
}

.price-free {
  color: #a7f3d0;
  background-color: rgba(52, 211, 153, 0.1);
}

.price-paid {
  color: #fde047;
  background-color: rgba(253, 224, 71, 0.1);
}
```
