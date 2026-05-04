---
status: not-started
---

# Prompt 6: UI - Add "Purchase" Button for Priced Skills

**Status:** Not Started

## Objective
Update the agent detail page UI to display a "Purchase" or "Buy" button next to skills that are not free and have not yet been purchased by the user.

## Explanation
Following on from Prompt 1 where we displayed the price, we now need to add a call to action. This involves checking if the user already owns the skill. We will use the `check-skill-access` API endpoint created in the previous step. The button's state will depend on three factors: is the skill priced, and does the user own it?

## Instructions
- [ ] **Modify `src/marketplace.js`:**
    - [ ] In the `renderDetail` function, before rendering the skills list, fetch the user's access status for all skills on the current agent. You can create a new function for this that calls your `/api/marketplace/check-skill-access` endpoint for each skill.
    - [ ] Store the owned skills in a `Set` for quick lookups.
    - [ ] In the `map` function that renders each skill, add a condition:
        - If `price` exists and the skill is in the `ownedSkills` set, show an "Owned" badge.
        - If `price` exists and the skill is *not* in the `ownedSkills` set, render a purchase button.
        - If the skill is free, show the "Free" badge as before.

## Code Example (`src/marketplace.js`)

```javascript
// A new helper function to get all owned skills for an agent
async function getOwnedSkills(agentId, skills) {
    const owned = new Set();
    // In a real app, you might want a single API call for this,
    // but for now, parallel checks are fine.
    await Promise.all(skills.map(async (s) => {
        const name = typeof s === 'string' ? s : s.name;
        try {
            const res = await fetch(`/api/marketplace/check-skill-access?agent_id=${agentId}&skill_name=${name}`);
            const data = await res.json();
            if (data.has_access) {
                owned.add(name);
            }
        } catch (e) { console.error('Failed to check skill access', e); }
    }));
    return owned;
}

// Inside renderDetail function, before rendering skills
const skillsArr = a.skills ? (Array.isArray(a.skills) ? a.skills : Object.values(a.skills)) : [];
const ownedSkills = await getOwnedSkills(a.id, skillsArr);

const skillPrices = a.skill_prices || {};
$('d-skills').innerHTML = skillsArr.length
    ? skillsArr.map((s) => {
        const name = typeof s === 'string' ? s : (s.name || '');
        const price = skillPrices[name];
        
        let badgeOrButton = `<span class="price-badge price-free">Free</span>`;
        if (price) {
            if (ownedSkills.has(name)) {
                badgeOrButton = `<span class="price-badge price-owned">✓ Owned</span>`;
            } else {
                badgeOrButton = `<button class="purchase-btn" data-agent-id="${a.id}" data-skill-name="${name}">
                    Buy for ${(price.amount / 1e6).toFixed(2)} USDC
                </button>`;
            }
        }
        return `<span class="skill-entry">${escapeHtml(name)}${badgeOrButton}</span>`;
    }).join(' ')
    : '<div>This Agent has no skills defined.</div>';
```

## Tracking
- To mark this task as complete, check all boxes in the instructions and change the status in the frontmatter to `Completed`.
