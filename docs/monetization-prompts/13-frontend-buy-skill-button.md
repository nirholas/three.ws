# Prompt 13: "Buy Skill" Button on Agent Detail Page

## Objective
Add a "Buy" or "Unlock" button next to paid skills on the agent detail page in the marketplace.

## Explanation
Following Prompt 01 where we displayed the price, we now need to add a call-to-action button. This button will be the entry point for the user to initiate the purchase flow. It should only appear for skills that have a price and that the current user has not yet purchased.

## Instructions
1.  **Fetch User's Purchased Skills:**
    *   The backend endpoint for the agent detail page (`/api/marketplace/agents/:id`) needs to know the current user to determine which skills they own.
    *   If a user is logged in, fetch their purchase history for the current agent from `user_skill_purchases`.
    *   Add a new field to the agent detail response, e.g., `owned_skills: ["skill_name1", "skill_name2"]`.

2.  **Update Frontend Skill Rendering:**
    *   In `src/marketplace.js`, within the `renderDetail` function's skill-rendering loop:
    *   Check if the current skill is in the `owned_skills` array.
    *   Check if the skill has a price in the `skill_prices` object.
    *   **Conditional Rendering Logic:**
        *   If `price` exists AND the skill is NOT in `owned_skills`: Render a "Buy" button.
        *   If `price` exists AND the skill IS in `owned_skills`: Render an "Owned" badge or checkmark.
        *   If `price` does not exist: Render the "Free" badge.

3.  **Add Event Listener:**
    *   Attach a click event listener to the "Buy" button.
    *   The listener should call the `onBuySkill(agentId, skillId)` function created in Prompt 06, which kicks off the purchase modal and QR code generation.

## Code Example (`src/marketplace.js`)

```javascript
// Inside renderDetail function

const skillPrices = a.skill_prices || {};
const ownedSkills = new Set(a.owned_skills || []);

$('d-skills').innerHTML = skillsArr.map((s) => {
    const name = s.name || '';
    const price = skillPrices[name];
    let badge = '';

    if (price) {
        if (ownedSkills.has(name)) {
            badge = `<span class="badge owned">✓ Owned</span>`;
        } else {
            const priceStr = `${(price.amount / 1e6).toFixed(2)} USDC`;
            badge = `<button class="btn-buy" data-agent-id="${a.id}" data-skill-id="${name}">Buy for ${priceStr}</button>`;
        }
    } else {
        badge = `<span class="price-badge price-free">Free</span>`;
    }
    return `<span class="skill-entry">${escapeHtml(name)}${badge}</span>`;
}).join(' ');
```
