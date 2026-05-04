# Prompt 2: Add Purchase Button for Priced Skills

**Status:** - [ ] Not Started

## Objective
On the agent detail page, display a "Purchase" button next to paid skills and an "Owned" or "Equipped" label for skills the user has already purchased.

## Explanation
Building on the previous step, now that prices are displayed, the next logical step is to provide a call to action for users to buy the skill. This prompt focuses on updating the UI to include this button and reflect the user's ownership status of a skill.

## Instructions
1.  **Fetch User's Purchased Skills:**
    *   You'll need an API endpoint to get the skills a user has purchased for a specific agent. Let's assume a new endpoint `/api/users/me/agent-skills/:agentId`.
    *   This endpoint should return a list of skill names the user owns for that agent.

2.  **Update Frontend Data Fetching:**
    *   In `src/marketplace.js`, within `renderDetail`, after fetching the agent details, make another API call to fetch the user's purchased skills for the current agent.

3.  **Modify UI Rendering Logic:**
    *   In the `renderDetail` function, when looping through the agent's skills, you now have access to `skillPrices` and the `purchasedSkills`.
    *   The logic for rendering each skill entry should be updated:
        *   If the skill is free (no price in `skillPrices`), show the "Free" badge.
        *   If the skill is paid and the user has purchased it (skill name is in `purchasedSkills`), show an "Owned" badge/label.
        *   If the skill is paid and the user has *not* purchased it, show the price and a "Purchase" button.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Inside renderDetail function, after fetching agent and purchased skills

const skillPrices = a.skill_prices || {};
const purchasedSkills = userSkills || []; // from new API call

$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];
        const isOwned = purchasedSkills.includes(name);

        let badgeOrButton = '';
        if (isOwned) {
            badgeOrButton = `<span class="skill-status-badge skill-owned">Owned</span>`;
        } else if (price) {
            const priceInUSDC = (price.amount / 1e6).toFixed(2);
            badgeOrButton = `<button class="purchase-btn" data-skill-name="${escapeHtml(name)}">Purchase for ${priceInUSDC} USDC</button>`;
        } else {
            badgeOrButton = `<span class="price-badge price-free">Free</span>`;
        }

        return `<div class="skill-entry">
                  <span class="skill-name">${escapeHtml(name)}</span>
                  ${badgeOrButton}
                </div>`;
    }).join('')
    : '<div>This Agent has no skills defined.</div>';

```

## CSS Example

Add these styles to `/marketplace.css` for the new elements.

```css
.skill-entry {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}

.purchase-btn {
  background-color: var(--accent);
  color: white;
  border: none;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.purchase-btn:hover {
  background-color: #5a4ccc; /* A slightly darker shade of accent */
}

.skill-status-badge {
  display: inline-block;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  vertical-align: middle;
}

.skill-owned {
  color: #a7f3d0;
  background-color: rgba(52, 211, 153, 0.1);
}
```
