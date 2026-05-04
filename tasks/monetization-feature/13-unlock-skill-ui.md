# Prompt 13: Update UI to Permanently Unlock Skill

## Objective
After a successful purchase, update the agent detail page UI to show the newly purchased skill as "Unlocked," and ensure this state persists on page reload.

## Explanation
Currently, after a successful payment, the modal closes, but the underlying page doesn't change. The "Purchase" button for the skill is still visible. We need to update the state of our application to reflect the new ownership and re-render the skill list to change the button to "Unlocked."

This requires two parts:
1.  A way to keep track of unlocked skills in the frontend's state.
2.  A re-rendering mechanism to update the UI when that state changes.

## Instructions
1.  **Introduce a Frontend State for Unlocked Skills:**
    *   In `src/marketplace.js`, create a global set or array to store the names of skills the user has unlocked in the current session. For example: `let unlockedSkills = new Set();`

2.  **Update State After Purchase:**
    *   In the `handlePurchase` function, after the backend confirmation is successful, add the newly purchased skill's name to your `unlockedSkills` set.

3.  **Create a Re-render Function:**
    *   Refactor the skill-rendering logic from the `renderDetail` function into its own standalone function, e.g., `renderSkillList(agent)`.
    *   This new function should take the agent object as an argument, access the global `unlockedSkills` set, and generate the HTML for the skills section, correctly showing "Unlocked" buttons for the skills in the set.
    *   The original `renderDetail` function will now call `renderSkillList(agent)` to render the skills initially.

4.  **Trigger Re-render After Purchase:**
    *   After adding the skill to the `unlockedSkills` set in `handlePurchase`, call your new `renderSkillList(detailState.agent)` function. This will immediately update the UI on the page behind the modal, before it closes.

## Code Example (Frontend - `src/marketplace.js`)

```javascript
// --- At the top of the file ---
let unlockedSkills = new Set(); // In a real app, this would be populated from an API call on load


// --- New function, refactored from renderDetail ---
function renderSkillList(agent) {
    const skillsContainer = $('d-skills');
    if (!skillsContainer) return;

    const skillsArr = Array.isArray(agent.capabilities.skills) ? agent.capabilities.skills : agent.skills || [];
    const skillPrices = agent.skill_prices || {};
    
    skillsContainer.innerHTML = skillsArr.length
        ? skillsArr.map((s) => {
            const name = typeof s === 'string' ? s : (s.name || '');
            const price = skillPrices[name];
            
            let actionButton;
            if (unlockedSkills.has(name)) {
                actionButton = `<button class="skill-btn" disabled>Unlocked</button>`;
            } else if (price) {
                actionButton = `<button class="skill-btn purchase" data-skill-name="${escapeHtml(name)}">Purchase</button>`;
            } else {
                actionButton = `<button class="skill-btn" disabled>Free</button>`;
            }

            const priceDisplay = price ? `<span class="price-paid">${(price.amount / 1e6).toFixed(2)} USDC</span>` : ``;

            return `<div class="skill-row">
                        <span class="skill-name">${escapeHtml(name)} ${priceDisplay}</span>
                        ${actionButton}
                    </div>`;
        }).join('')
        : '<div>This Agent has no skills defined.</div>';
}

// --- Modify the original renderDetail function ---
function renderDetail(a, bookmarked) {
    // ... all the existing code to render name, description, etc.
    
    // Replace the old innerHTML logic for skills with a call to the new function
    renderSkillList(a);

    // ... rest of the function
}

// --- Update the handlePurchase function ---
async function handlePurchase() {
    // ... inside the successful payment logic, after backend confirmation
    try {
        // ...
        const verifyBody = await verifyRes.json();
        if (!verifyRes.ok) throw new Error(verifyBody.error_description);

        statusEl.textContent = 'Success! Skill unlocked.';
        statusEl.classList.add('ok');

        // *** NEW CODE HERE ***
        const skillName = intent.payload.skill; // Assuming intent has skill name
        unlockedSkills.add(skillName);
        renderSkillList(detailState.agent); // Re-render the skills on the page

        setTimeout(closePaymentModal, 2000);
    } catch (error) {
        // ...
    }
}
```
**Note:** This only persists the "unlocked" state for the current session. The next set of prompts will address fetching this data from the server so it persists across reloads.
