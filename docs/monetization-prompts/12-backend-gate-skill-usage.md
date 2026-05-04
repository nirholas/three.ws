# Prompt 12: Backend Logic to Gate Skill Usage

## Objective
Modify the agent's skill execution logic to check if a user is licensed to use a paid skill before running it.

## Explanation
Selling skills is only effective if their usage can be restricted to paying users. This requires adding a check in the agent's core runtime. Before executing any skill, the runtime must determine if the skill is priced and, if so, whether the current user has purchased it.

## Instructions
1.  **Locate the Skill Execution Logic:**
    *   Find the part of the agent runtime where skills are called. This is likely in `src/runtime/index.js` or a related file that handles the LLM tool-loop.

2.  **Add a Pre-Execution Check:**
    *   Before a skill's handler is invoked, insert a new check.
    *   **Is the skill priced?** Query the `agent_skill_prices` table for the current agent and the skill being called.
    *   **If it is priced, does the user have a license?**
        *   Get the current user's ID. Note: You'll need to pass user context into the runtime.
        *   Query the `user_skill_purchases` table to see if a `'confirmed'` purchase record exists for this `user_id`, `agent_id`, and `skill_id`.
    *   **Enforce the Gate:**
        *   If the skill is priced and the user has *not* purchased it, do not execute the skill.
        *   Instead, return a specific error message to the LLM (e.g., `tool_error: "User has not purchased this skill."`).

3.  **Instruct the LLM on How to Respond:**
    *   Update the system prompt (e.g., in `api/chat.js`) to instruct the agent on what to do when it receives this specific error.
    *   It should inform the user that the skill is a premium feature and they need to purchase it to use it.

## Code Example (Conceptual - in agent runtime)

```javascript
// Before calling a skill's handler function...

async function canUseSkill(userId, agentId, skillId) {
    // This check would be done via an API call from the client, or directly if on the server.
    const isPriced = await db.checkIfSkillIsPriced(agentId, skillId);
    if (!isPriced) {
        return true; // Free skill, allow usage.
    }

    if (!userId) {
        return false; // Priced skill, but user is not logged in.
    }

    const hasPurchased = await db.checkIfUserHasPurchased(userId, agentId, skillId);
    return hasPurchased;
}

// In the tool-loop
const allowed = await canUseSkill(currentUser.id, agent.id, toolCall.name);
if (allowed) {
    // Execute tool
} else {
    // Return error to LLM
    return {
        tool_use_id: toolCall.id,
        content: JSON.stringify({ error: "User has not purchased this skill." }),
    };
}
```
