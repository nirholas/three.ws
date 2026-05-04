---
status: not-started
---

# Prompt 2: Add Purchase Button for Paid Skills

## Objective
On the agent detail page, display a "Purchase" button next to paid skills that the current user has not yet unlocked. This button will initiate the skill purchase flow.

## Explanation
Building on the previous step where we displayed skill prices, we now need to provide a clear call-to-action for users to buy these skills. This involves checking if the user already owns the skill and rendering a button accordingly. For this, we'll need to know which skills the user has unlocked.

## Instructions
- [ ] **Modify the Backend API:**
  - [ ] The agent detail endpoint (`/api/marketplace/agents/:id`) needs to also return information about which skills the logged-in user has unlocked for that agent.
  - [ ] You will need to query the `user_unlocked_skills` table (you will create this in a later prompt) using the current `user_id` and the `agent_id`.
  - [ ] Include an `unlocked_skills` array of skill names in the API response for the currently logged in user.

- [ ] **Update the Frontend UI:**
  - [ ] In `src/marketplace.js`, find the `renderDetail` function.
  - [ ] When rendering the skills list, for each skill, check if it's priced and if it is NOT in the `unlocked_skills` array from the API response.
  - [ ] If a skill is priced and not unlocked, render a "Purchase" button next to the price badge.
  - [ ] If a skill is priced and IS unlocked, show an "Owned" badge.
  - [ ] The purchase button should have a `data-skill-name` attribute to identify which skill is being purchased when clicked.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Inside renderDetail function, an updated version of the skill rendering logic:

const skillPrices = a.skill_prices || {};
const unlockedSkills = new Set(a.unlocked_skills || []);

$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];
        let badge = '';

        if (price) {
            if (unlockedSkills.has(name)) {
                badge = '<span class="price-badge price-owned">✓ Owned</span>';
            } else {
                const priceInUSDC = (price.amount / 1e6).toFixed(2);
                badge = `
                    <span class="price-badge price-paid">${priceInUSDC} USDC</span>
                    <button class="purchase-btn" data-skill-name="${escapeHtml(name)}">Purchase</button>
                `;
            }
        } else {
            badge = '<span class="price-badge price-free">Free</span>';
        }

        return `<span class="skill-entry">${escapeHtml(name)}${badge}</span>`;
    }).join(' ')
    : '<div>This Agent has no skills defined.</div>';
```

## CSS Example

Add these styles for the button and owned badge to `/marketplace.css`:

```css
.purchase-btn {
  margin-left: 8px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  background-color: var(--accent);
  color: white;
  border: none;
  cursor: pointer;
}

.price-owned {
  color: #a7f3d0;
  background-color: transparent;
  border: 1px solid rgba(52, 211, 153, 0.3);
}
```
