---
status: not-started
---

# Prompt 15: Add "Buy" Button to Marketplace

**Status:** Not Started

## Objective
Modify the agent detail page in the marketplace to show a "Buy" button next to paid skills that the user has not yet purchased.

## Explanation
This is the call-to-action for users. Instead of just showing a price, we need to provide an interactive button that initiates the purchase flow. The button's state should depend on whether the user is logged in and whether they already own the skill.

## Instructions
- [ ] **Update Frontend Data Fetching:**
    - [ ] When the marketplace page loads, in addition to fetching agent details, also make a call to the `/api/users/my-skills` endpoint (from Prompt 7) to get a list of the user's purchased skills. Store this in a local variable. This should only be done if the user is logged in.
- [ ] **Modify the `renderDetail` function in `src/marketplace.js`:**
    - [ ] Inside the loop that renders skills, you now have access to both the `skillPrices` and the `userPurchases`.
    - [ ] Add a new function or logic to determine the button's state for each skill:
        - If the skill is free: show a "Free" badge.
        - If the skill is paid and the user owns it: show an "Owned" badge or a disabled button.
        - If the skill is paid and the user does *not* own it: show an active "Buy for X USDC" button.
        - If the user is not logged in: the "Buy" button should prompt them to sign in.
- [ ] **Add `data-` attributes to the button** to store the `agentId` and `skillName`, which will be needed to start the purchase flow.

## Code Example (JavaScript in `src/marketplace.js`)

```javascript
// Assumes `userPurchases` is a lookup map like { "agent_id:skill_name": true }
const skillPrices = a.skill_prices || {};
const userPurchases = state.mySkills || {}; // state.mySkills is fetched on load

$('d-skills').innerHTML = skillsArr.map(s => {
    const name = s.name || s;
    const price = skillPrices[name];
    const purchaseKey = `${a.id}:${name}`;
    const isOwned = userPurchases[purchaseKey];

    let badgeOrButton;
    if (isOwned) {
        badgeOrButton = `<span class="price-badge price-owned">Owned</span>`;
    } else if (price) {
        badgeOrButton = `<button class="btn-buy" data-agent-id="${a.id}" data-skill-name="${name}">
            Buy for ${(price.amount / 1e6).toFixed(2)} USDC
        </button>`;
    } else {
        badgeOrButton = `<span class="price-badge price-free">Free</span>`;
    }

    return `<span class="skill-entry">${escapeHtml(name)}${badgeOrButton}</span>`;
}).join(' ');
```
