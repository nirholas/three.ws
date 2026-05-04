---
status: not-started
---

# Prompt 7: Add Purchase Button to UI

**Status:** Not Started

## Objective
Update the agent detail page in the marketplace to display a "Purchase" or "Unlock" button next to paid skills that the user has not yet purchased.

## Explanation
Now that the backend can identify priced skills, we need to provide a clear call-to-action for the user. This prompt focuses on the UI changes required to show the correct button based on the skill's price and the user's purchase history. This is the first step in building the frontend purchasing flow.

## Instructions

1.  **Fetch User's Purchased Skills:**
    *   In `src/marketplace.js`, when the marketplace page loads, make a call to the new `/api/user/purchased-skills` endpoint if the user is logged in.
    *   Store the returned list of purchased skills in a variable accessible by the `renderDetail` function.

2.  **Modify the `renderDetail` Function:**
    *   Inside the `renderDetail` function, you already have logic to display a price badge. Now, extend that logic.
    *   For each skill, perform the following checks:
        a. Does the skill have a price? (`skillPrices[name]`)
        b. If it has a price, has the current user already purchased this skill for this agent? (Check against the list of purchased skills).
    *   Render the UI conditionally:
        *   If the skill has no price, show the "Free" badge.
        *   If the skill has a price and the user **has not** purchased it, show the price and a "Purchase" button.
        *   If the skill has a price and the user **has** purchased it, show an "Owned" or "Unlocked" badge and disable or hide the purchase button.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// In src/marketplace.js, assuming `userPurchases` is fetched and available

// Inside renderDetail function
const userPurchasesForThisAgent = userPurchases[a.id] || [];
const skillPrices = a.skill_prices || {};

$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];
        let badge = `<span class="price-badge price-free">Free</span>`;

        if (price) {
            const isPurchased = userPurchasesForThisAgent.includes(name);
            const priceDisplay = (price.amount / 1e6).toFixed(2);

            if (isPurchased) {
                badge = `<span class="price-badge price-owned">✓ Owned</span>`;
            } else {
                badge = `
                    <span class="price-badge price-paid">${priceDisplay} USDC</span>
                    <button class="btn-purchase" data-agent-id="${a.id}" data-skill-name="${name}">
                      Purchase
                    </button>
                `;
            }
        }
        return `<span class="skill-entry">${escapeHtml(name)}${badge}</span>`;
    }).join(' ')
    : '<div>This Agent has no skills defined.</div>';

// Add event listeners for the new buttons after setting innerHTML
document.querySelectorAll('.btn-purchase').forEach(btn => {
  btn.addEventListener('click', handlePurchaseClick);
});
```

## CSS Example (add to `/marketplace.css`)

```css
.btn-purchase {
  margin-left: 8px;
  padding: 3px 8px;
  font-size: 10px;
  background-color: #fde047;
  color: #1c1917;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  transition: background-color 0.2s;
}
.btn-purchase:hover {
  background-color: #facc15;
}
.price-owned {
  color: #a7f3d0;
  background-color: rgba(52, 211, 153, 0.1);
}
```
