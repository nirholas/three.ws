---
status: not-started
---

# Prompt 18: Frontend UI State Update Post-Purchase

**Status:** Not Started

## Objective
Ensure the UI on the agent detail page correctly updates to reflect a newly purchased skill without requiring a full page reload.

## Explanation
After a user successfully buys a skill, the "Buy" button for that skill should immediately change to an "Owned" badge. This provides instant feedback and prevents the user from accidentally trying to buy the same skill again.

## Instructions
- [ ] **Refactor UI Update Logic:**
    - [ ] Make sure your logic for rendering the skills list and their buttons is in a reusable function (e.g., `updateSkillDisplay(agent, purchases)`).
- [ ] **Trigger UI Update:**
    - [ ] After the purchase is confirmed (in the logic from Prompt 17), you need to update the local state that holds the user's purchased skills.
    - [ ] You can do this in two ways:
        1.  **Optimistic Update:** Immediately add the new skill's key (`agent_id:skill_name`) to your local `userPurchases` object and re-render. This is fast but could be wrong if there's a server error.
        2.  **Refetch:** Call the `/api/users/my-skills` endpoint again to get the canonical list of purchases from the server, then re-render. This is more reliable.
- [ ] **Call the Rendering Function:**
    - [ ] After updating the local `userPurchases` data, call your reusable rendering function to redraw the skills list. The logic you wrote in Prompt 15 should now automatically show the "Owned" badge for the new skill.

## Code Example (JavaScript)

```javascript
// state.mySkills is the object holding user's purchases, e.g., { "agentId:skillName": true }
// state.currentAgent is the agent being viewed

async function handlePurchaseSuccess(agentId, skillName) {
    // Option 2: Refetch data for reliability
    try {
        const response = await fetch('/api/users/my-skills');
        const data = await response.json();
        state.mySkills = data.purchased; // Update global state
    } catch (err) {
        console.error("Failed to refresh user's skills:", err);
        // Fallback or show error
    }

    // Now re-render the skills section
    renderSkillsForAgent(state.currentAgent, state.mySkills);
}

function renderSkillsForAgent(agent, purchases) {
    // This is the rendering logic from Prompt 15, now in its own function
    const skillsContainer = document.getElementById('d-skills');
    // ... logic to build the innerHTML for skills based on purchases ...
    skillsContainer.innerHTML = '...';
}

// In the purchase confirmation logic (from Prompt 17)...
if (status === 'confirmed') {
    clearInterval(pollInterval);
    showSuccessAndCloseModal();
    handlePurchaseSuccess(agentIdBeingPurchased, skillNameBeingPurchased);
}
```
