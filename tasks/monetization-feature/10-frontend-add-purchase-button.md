---
status: not-started
---
# Prompt 10: Add Purchase Button to Marketplace

**Status:** Not Started

## Objective
In the marketplace agent detail page, add a "Purchase" button next to skills that are not free.

## Explanation
Now that skills can have prices, the marketplace UI must be updated to allow users to initiate a purchase. This task modifies the existing skill rendering logic to include a "Purchase" button, which will be wired up in subsequent tasks.

## Instructions
1.  **Open `src/marketplace.js` and locate the `renderDetail` function.**
2.  **Modify the skill rendering loop.** The agent details from the API should already include pricing information from Prompt #1.
3.  **Update the logic that generates the skill badge:**
    - If a skill is free, continue showing the "Free" badge.
    - If a skill has a price and has **not** been purchased by the user, show the price and a "Purchase" button.
    - If a skill has a price and **has** been purchased, show the price and an "Owned" indicator.
4.  You will need a way to know which skills the user already owns for a given agent. This may require an API modification to include a list of purchased `skill_id`s in the agent detail payload.

## Code Example (Frontend - `src/marketplace.js`, modified `renderDetail`)
```javascript
// Inside renderDetail function
const skillPrices = a.skill_prices || {};
const ownedSkills = a.owned_skills || []; // Assumes API now provides this array of skill names

$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];
        
        let badgeHtml = '';
        if (price) {
            const priceDisplay = `${(price.amount / 1e6).toFixed(2)} USDC`;
            if (ownedSkills.includes(name)) {
                badgeHtml = `<span class="price-badge price-owned">Owned</span> <span class="price-display">${priceDisplay}</span>`;
            } else {
                badgeHtml = `<span class="price-display">${priceDisplay}</span> <button class="purchase-btn" data-skill-name="${name}">Purchase</button>`;
            }
        } else {
            badgeHtml = `<span class="price-badge price-free">Free</span>`;
        }
        
        return `<span class="skill-entry">${escapeHtml(name)}${badgeHtml}</span>`;
    }).join(' ')
    : '<div>This Agent has no skills defined.</div>';
```
