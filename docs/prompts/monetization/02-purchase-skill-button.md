---
status: not-started
---
# Prompt 2: Add Purchase Button for Priced Skills

## Objective
In the agent detail page, replace the price badge for unowned, paid skills with a "Purchase" button to initiate the buying process.

## Explanation
Displaying the price is the first step. Now, we need to give users a clear call-to-action to buy the skill. This prompt focuses on changing the UI to be interactive. The actual payment flow will be handled in subsequent prompts.

## Instructions
1.  **Check Ownership:**
    *   The frontend needs to know which skills the current user already owns. Create a new API endpoint (e.g., `/api/users/me/purchased-skills`) that returns a list of skill IDs owned by the authenticated user.
    *   In `src/marketplace.js`, fetch the list of purchased skills when the component mounts.

2.  **Conditionally Render Button:**
    *   Inside the `renderDetail` function, modify the skill rendering loop.
    *   For each skill, determine its state: free, paid and owned, or paid and unowned.
    *   - If free, show the "Free" badge.
    *   - If paid and owned, show an "Owned" badge.
    *   - If paid and unowned, show a "Purchase" button with the price.

3.  **Button Styling:**
    *   Style the "Purchase" button to be a prominent call-to-action.
    *   Style the "Owned" badge to give the user clear feedback.

## Code Example (Frontend - `src/marketplace.js`)
```javascript
// Inside renderDetail function, assuming `ownedSkills` is a Set of skill names

const skillPrices = a.skill_prices || {};
$('d-skills').innerHTML = skillsArr.map(s => {
    const name = typeof s === 'string' ? s : (s.name || '');
    const price = skillPrices[name];
    const isOwned = ownedSkills.has(name);
    let badge = '';

    if (price && !isOwned) {
        badge = `<button class="purchase-btn" data-skill-name="${escapeHtml(name)}">${(price.amount / 1e6).toFixed(2)} USDC</button>`;
    } else if (price && isOwned) {
        badge = `<span class="price-badge price-owned">Owned</span>`;
    } else {
        badge = `<span class="price-badge price-free">Free</span>`;
    }
    return `<span class="skill-entry">${escapeHtml(name)}${badge}</span>`;
}).join(' ');
```

## CSS Example (`/marketplace.css`)
```css
.purchase-btn {
  background-color: #5a67d8;
  color: white;
  border: none;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  margin-left: 8px;
  vertical-align: middle;
  transition: background-color 0.2s;
}

.purchase-btn:hover {
  background-color: #434190;
}

.price-owned {
  color: #9ae6b4;
  background-color: rgba(72, 187, 120, 0.1);
}
```
