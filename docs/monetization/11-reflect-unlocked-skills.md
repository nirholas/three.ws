---
status: not-started
---

# Prompt 11: Reflect Unlocked Skills in UI

## Objective
Update the user interface to visually indicate which skills a user has purchased and remove the "Buy" button for those skills.

## Explanation
After a user successfully purchases a skill, the UI should immediately update to reflect their new ownership status. This provides instant gratification and prevents them from trying to buy the same skill again. This requires fetching the user's unlocked skills and using that data in the rendering logic.

## Instructions
1.  **Create a Backend Endpoint for User Skills:**
    *   Create a new API endpoint, e.g., `GET /api/users/me/unlocked-skills`.
    *   This endpoint should be authenticated and return a list of all skills the currently logged-in user has purchased.
    *   The response could be an array of objects, e.g., `[{ agent_id: '...', skill_name: '...' }]`, or structured as a map for easier lookup on the frontend.

2.  **Fetch Unlocked Skills on Page Load:**
    *   In the marketplace JavaScript, when the agent detail page loads, make a call to this new endpoint.
    *   Store the list of unlocked skills in a client-side variable (e.g., a `Set` for fast lookups).

3.  **Update the `userHasSkill` Function:**
    *   Modify the mock `userHasSkill` function created in a previous step.
    *   It should now check against the list of skills fetched from the API. The check might need to be specific to the agent, e.g., `userHasSkill(agentId, skillName)`.

4.  **Trigger UI Re-render After Purchase:**
    *   In the `PurchaseFlow` module, after a transaction is successfully confirmed, the UI needs to be updated.
    *   The simplest way is to add the newly purchased skill to the client-side list of unlocked skills and then call the main `renderDetail` function again to completely re-render the agent's skill list.

## Code Example (Backend API - User Skills)

```javascript
// GET /api/users/me/unlocked-skills
app.get('/api/users/me/unlocked-skills', async (req, res) => {
    const userId = await getUserIdFromRequest(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const { rows } = await db.query(
      'SELECT agent_id, skill_name FROM user_unlocked_skills WHERE user_id = $1',
      [userId]
    );
    // Return a map for easy frontend lookup: { "agentId:skillName": true }
    const unlockedSkillsMap = rows.reduce((acc, row) => {
      acc[`${row.agent_id}:${row.skill_name}`] = true;
      return acc;
    }, {});
    res.json(unlockedSkillsMap);
});
```

## Code Example (Frontend JavaScript)

```javascript
// --- State management ---
let unlockedSkills = {}; // Will hold the map from the API

// --- On page load ---
async function initializeAgentDetailPage(agentId) {
    // Fetch agent details...
    // Then fetch user's skills
    try {
        const response = await fetch('/api/users/me/unlocked-skills');
        if (response.ok) {
            unlockedSkills = await response.json();
        }
    } catch (e) {
        console.error("Couldn't fetch user skills. Assuming none are unlocked.", e);
    }
    // Now render the agent details
    renderDetail(agent);
}

// --- Update the check function ---
function userHasSkill(agentId, skillName) {
    return !!unlockedSkills[`${agentId}:${skillName}`];
}

// --- Update rendering logic to use the new check ---
// (No changes needed if it already calls userHasSkill(agent.id, name))

// --- Update PurchaseFlow on success ---
// Inside startMonitoring(), in the 'confirmed' block:
if (data.status === 'confirmed') {
    this.stopMonitoring();
    showToast('Payment confirmed!', 'success');
    hidePaymentModal();

    // Add the skill to our local state
    const { agent, skillName } = this.currentPurchase;
    unlockedSkills[`${agent.id}:${skillName}`] = true;

    // Re-render the agent details to update the UI
    renderDetail(agent);
}
```
