---
status: not-started
last_updated: 2026-05-04
---
# Prompt 05: UI for Purchasing a Skill

## Objective
On the agent detail page, replace the static price badge for paid skills with an interactive "Purchase" button.

## Explanation
Displaying the price is the first step. The next is to allow users to initiate a purchase. This involves changing the UI from a passive display to an active one. When a user clicks the "Purchase" button, it should trigger the on-chain purchase flow. For this task, we will focus only on creating the button and its initial states.

## Instructions
1.  **Identify User's Owned Skills:**
    *   The API that fetches agent details for the marketplace view should also determine which skills the *currently authenticated user* already owns.
    *   This requires a new database query to check the `user_purchased_skills` table (which we will create in a later prompt). For now, you can assume the API returns a list of owned skill names, e.g., `agent.owned_skills: ["skill1", "skill2"]`.

2.  **Update the UI in `src/marketplace.js`:**
    *   In the `renderDetail` function, where skills are rendered, implement conditional logic for each skill:
        *   If the skill is free, show a "Free" badge.
        *   If the skill is paid and the user already owns it, show an "Owned" badge or checkmark.
        *   If the skill is paid and the user does not own it, show a "Purchase" button with the price.

3.  **Button Styling:**
    *   Add CSS for the new "Purchase" button and "Owned" badge to make them clear and visually appealing.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// Inside renderDetail function
const skillPrices = a.skill_prices || {};
const ownedSkills = new Set(a.owned_skills || []); // Assume this is passed from the API

$('d-skills').innerHTML = skillsArr.map(s => {
    const name = typeof s === 'string' ? s : (s.name || '');
    const price = skillPrices[name];
    let badgeHtml = '';

    if (price) {
        if (ownedSkills.has(name)) {
            badgeHtml = `<span class="skill-badge owned">✓ Owned</span>`;
        } else {
            const priceInUsdc = (price.amount / 1e6).toFixed(2);
            badgeHtml = `<button class="btn btn-purchase" data-skill-name="${name}" data-agent-id="${a.id}">
                Purchase for ${priceInUsdc} USDC
            </button>`;
        }
    } else {
        badgeHtml = `<span class="skill-badge free">Free</span>`;
    }

    return `<div class="skill-entry">
                <span class="skill-name">${escapeHtml(name)}</span>
                ${badgeHtml}
            </div>`;
}).join('');

// Add event listener for purchase buttons
document.getElementById('d-skills').addEventListener('click', (e) => {
    if (e.target.matches('.btn-purchase')) {
        const skillName = e.target.dataset.skillName;
        const agentId = e.target.dataset.agentId;
        // The purchase flow logic will be implemented in the next prompt
        console.log(`Initiating purchase for skill '${skillName}' from agent '${agentId}'`);
        e.target.disabled = true;
        e.target.textContent = 'Preparing...';
    }
});
```

## CSS Example

```css
/* Add to marketplace.css */
.skill-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  border-radius: 6px;
  background-color: #1a1a24; /* var(--panel2) */
  margin-bottom: 6px;
}

.skill-badge, .btn-purchase {
  flex-shrink: 0;
}

.btn-purchase {
  font-size: 12px;
  padding: 5px 10px;
  background-color: var(--accent);
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
}

.btn-purchase:hover {
  filter: brightness(1.1);
}

.btn-purchase:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.skill-badge.owned {
  color: #4ade80; /* var(--ok) */
  font-weight: 600;
}

.skill-badge.free {
  color: #888; /* var(--muted) */
}
```
