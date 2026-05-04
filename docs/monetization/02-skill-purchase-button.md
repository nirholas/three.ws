# Prompt 2: Add Purchase Button for Paid Skills

## Objective
Add an "Unlock" or "Purchase" button next to paid skills on the agent detail page in the marketplace.

## Explanation
With prices now visible, the next logical step is to provide a clear call-to-action for users to initiate a purchase. This button will be the entry point into the skill acquisition flow.

## Instructions
1.  **Update Frontend UI (`src/marketplace.js`):**
    *   In the `renderDetail` function, modify the loop that renders each skill.
    *   For skills that have a price, render a `<button>` element next to the price badge.
    *   The button should be labeled "Unlock" or "Purchase."
    *   Assign a `data-skill-name` attribute to the button, containing the name of the skill, to identify it in event listeners.
    *   Attach a click event listener to these buttons. For now, this listener can log to the console. It will be wired up to open a purchase modal in a later step.

2.  **Add CSS for the Button:**
    *   In `/marketplace.css`, add styling for the new purchase button to make it visually distinct and interactive.

## Code Example (Frontend - `src/marketplace.js`)
```javascript
// Inside renderDetail's map function for skills...
const skillPrices = a.skill_prices || {};
const name = typeof s === 'string' ? s : (s.name || '');
const price = skillPrices[name];
let badge;
let actionButton = '';

if (price) {
    badge = `<span class="price-badge price-paid">${(price.amount / 1e6).toFixed(2)} USDC</span>`;
    actionButton = `<button class="purchase-btn" data-skill-name="${escapeHtml(name)}">Unlock</button>`;
} else {
    badge = `<span class="price-badge price-free">Free</span>`;
}
return `<span class="skill-entry">${escapeHtml(name)}${badge}${actionButton}</span>`;
```

## CSS Example (`/marketplace.css`)
```css
.purchase-btn {
  margin-left: 8px;
  padding: 4px 10px;
  background-color: #4f46e5;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: background-color 0.2s;
}
.purchase-btn:hover {
  background-color: #4338ca;
}
```
