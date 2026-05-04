---
status: not-started
---

# Prompt 7: Frontend - "Unlock Skill" Button

## Objective
Update the marketplace UI (`marketplace.js` and `marketplace.html`) to show a prominent "Unlock" or "Purchase" button next to paid skills.

## Explanation
Now that we can display prices, the next logical step for the user is an action to purchase the skill. This task involves changing the static price badge into an interactive button for skills that are not free and have not yet been purchased by the user.

## Instructions
1.  **Fetch User's Unlocked Skills:**
    *   You'll need a way to know which skills the currently logged-in user already owns. This requires a new API endpoint, e.g., `GET /api/users/me/unlocked-skills`, which returns an array of skill names or IDs the user has purchased.
    *   In `marketplace.js`, when the application loads, fetch this list of unlocked skills and store it.

2.  **Modify the `renderDetail` function:**
    *   In `src/marketplace.js`, within the `renderDetail` function where you iterate over skills, you now need three pieces of information for each skill:
        1.  The skill's details (name, description).
        2.  The skill's price (from `agent.skill_prices`).
        3.  Whether the current user has unlocked it (from the list fetched in step 1).

3.  **Conditional Rendering Logic:**
    *   Inside the loop, implement the following logic for each skill:
        *   **If `price` does not exist:** The skill is free. Render a "Free" badge.
        *   **If `price` exists AND the user has unlocked the skill:** The skill is already owned. Render an "Unlocked" or "Owned" badge.
        *   **If `price` exists AND the user has NOT unlocked the skill:** The skill is available for purchase. Render a "Unlock for X USDC" button.

4.  **Add Data Attributes:**
    *   The "Unlock" button needs to have necessary information attached to it so its event handler knows what to do. Use `data-*` attributes to store the `agentId` and `skillName`.

## Code Example (`src/marketplace.js` inside `renderDetail`)

```javascript
// Assume `unlockedSkills` is a Set or array of skill names fetched on page load
const unlockedSkills = new Set(['Jupiter Swapper']); // Example data

// ... inside renderDetail loop ...
const skillPrices = a.skill_prices || {};
$('d-skills').innerHTML = skillsArr.map((s) => {
    const name = typeof s === 'string' ? s : (s.name || '');
    const price = skillPrices[name];
    
    let badgeHtml;
    if (!price) {
        badgeHtml = `<span class="price-badge price-free">Free</span>`;
    } else if (unlockedSkills.has(name)) {
        badgeHtml = `<span class="price-badge price-unlocked">✅ Unlocked</span>`;
    } else {
        const amount = (price.amount / 1e6).toFixed(2);
        badgeHtml = `
            <button 
                class="btn-unlock-skill" 
                data-agent-id="${escapeHtml(a.id)}" 
                data-skill-name="${escapeHtml(name)}">
                Unlock for ${amount} USDC
            </button>
        `;
    }

    return `<div class="skill-entry">
              <span class="skill-name">${escapeHtml(name)}</span>
              ${badgeHtml}
            </div>`;
}).join('');
```

## CSS Example (`/marketplace.css`)

```css
.skill-entry {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 4px;
  border-bottom: 1px solid #333;
}

.price-unlocked {
  color: #a7f3d0; /* Same as free, but with a checkmark */
  background-color: rgba(52, 211, 153, 0.1);
}

.btn-unlock-skill {
  background-color: #4f46e5;
  color: white;
  border: none;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 5px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-unlock-skill:hover {
  background-color: #6366f1;
}
```
