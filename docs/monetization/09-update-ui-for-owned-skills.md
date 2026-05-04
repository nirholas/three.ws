# Prompt 9: Update UI for Owned Skills

## Status
- [ ] Not Started

## Objective
Modify the agent detail page to visually reflect the skills a user already owns, disabling the "Purchase" button for those skills.

## Explanation
To prevent users from re-purchasing skills they already own, the UI needs to be updated based on their ownership status. This requires fetching the user's owned skills and adjusting the rendering logic.

## Instructions
1.  **Backend: Expose Owned Skills:**
    *   When fetching the agent details (`/api/marketplace/agents/:id`), if a user is authenticated, also query the `user_owned_skills` table.
    *   Include a list of owned skill names for that specific agent in the API response.

2.  **Frontend: Update Rendering Logic:**
    *   In `src/marketplace.js`, the `renderDetail` function will now receive the list of owned skills.
    *   In the skill rendering loop, check if the current skill is in the user's owned list.
    *   If the user owns the skill, display an "Owned" badge or indicator instead of the "Purchase" button.

## Code Example (Backend API Response Snippet)
```json
{
  "id": "agent-uuid-123",
  "name": "Super Agent",
  "skills": ["super-jump", "laser-eyes"],
  "skill_prices": {
    "laser-eyes": { "amount": 2000000, "currency_mint": "..." }
  },
  "user_owned_skills": ["super-jump"] 
}
```

## Code Example (Frontend - `src/marketplace.js` Update)
```javascript
// Inside renderDetail function
const skillPrices = a.skill_prices || {};
const ownedSkills = new Set(a.user_owned_skills || []); // Use a Set for efficient lookups

$('d-skills').innerHTML = skillsArr.map((s) => {
    const name = typeof s === 'string' ? s : (s.name || '');
    const price = skillPrices[name];
    let actionElement;

    if (ownedSkills.has(name)) {
        actionElement = `<span class="ownership-badge">Owned</span>`;
    } else if (price) {
        const priceDisplay = `${(price.amount / 1e6).toFixed(2)} USDC`;
        actionElement = `<button class="purchase-skill-btn" 
                            data-skill-name="${escapeHtml(name)}"
                            ... >
                            Purchase for ${priceDisplay}
                         </button>`;
    } else {
        // This is a free skill that hasn't been "claimed" or "owned" yet.
        // You might have a different state for free skills that are implicitly owned.
        actionElement = `<span class="price-badge price-free">Free</span>`;
    }

    return `<div class="skill-entry">
              <span>${escapeHtml(name)}</span>
              ${actionElement}
            </div>`;
}).join('');
```

## CSS for "Owned" Badge
```css
/* Add to marketplace.css */
.ownership-badge {
  display: inline-block;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  border-radius: 12px;
  background-color: #059669; /* Green */
  color: #d1fae5;
  border: 1px solid #06c78a;
}
```
