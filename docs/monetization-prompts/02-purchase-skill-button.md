# Prompt 02: Add Purchase Button for Priced Skills

## Objective
Add a "Purchase" button next to paid skills on the agent detail page, creating a clear call-to-action for users.

## Explanation
With prices now visible, the next step is to provide a way for users to initiate a purchase. This prompt focuses on adding the button to the UI. The button's functionality will be implemented in subsequent steps.

## Instructions
1.  **Update the Frontend UI (`src/marketplace.js`):**
    *   Modify the `renderDetail` function.
    *   In the skill rendering loop, if a skill is paid, render a "Purchase" button next to the price badge.
    *   For now, we will assume the user does not own any skills. In a later prompt, we will fetch user ownership data and update the button state (e.g., to a disabled "Unlocked" button).
    *   Add a `data-skill-name` attribute to the button to easily identify which skill is being purchased when the button is clicked.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Inside renderDetail's map function for skills
const name = typeof s === 'string' ? s : (s.name || '');
const price = skillPrices[name];

if (price) {
    // In a future step, isOwned will be dynamically determined.
    const isOwned = false; 
    const priceText = `${(price.amount / 1e6).toFixed(2)} USDC`;
    const badge = `<span class="price-badge price-paid">${priceText}</span>`;
    const button = isOwned
        ? `<button class="purchase-btn" disabled>Unlocked</button>`
        : `<button class="purchase-btn" data-skill-name="${escapeHtml(name)}">Purchase</button>`;
    return `<span class="skill-entry">${escapeHtml(name)}${badge}${button}</span>`;
} else {
    const badge = `<span class="price-badge price-free">Free</span>`;
    return `<span class="skill-entry">${escapeHtml(name)}${badge}</span>`;
}
```

## CSS Example

Add these styles to a relevant CSS file.

```css
.purchase-btn {
  margin-left: 8px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid #fde047;
  background-color: transparent;
  color: #fde047;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}

.purchase-btn:hover {
  background-color: #fde047;
  color: #111;
}

.purchase-btn:disabled {
  border-color: #444;
  color: #444;
  cursor: not-allowed;
  background-color: transparent;
}
```
