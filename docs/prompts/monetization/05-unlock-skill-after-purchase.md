---
status: not-started
---
# Prompt 5: Unlock Skill After Purchase

## Objective
Ensure that once a skill is purchased and verified, the user gains immediate access to use it with the agent.

## Explanation
The final step of the core purchase flow is to "unlock" the skill. This involves updating the application's state to reflect the new ownership and making sure that the agent's runtime can now execute this skill for the user.

## Instructions
1.  **Modify Skill Execution Logic:**
    *   Locate the core logic where an agent's skill is invoked by a user. This might be in the `Runtime` class or a similar agent-brain module.
    *   Before executing a skill, add a check:
        *   Is the skill priced?
        *   If so, does the current user own it?

2.  **Create an Ownership Check API:**
    *   Create a reusable backend function or endpoint, e.g., `hasSkillAccess(userId, agentId, skillName)`.
    *   This function should query your database (`skill_purchases` table) to see if a `completed` purchase record exists for that user and skill.
    *   The skill execution logic will call this function. If the user doesn't have access, the skill execution should fail with an informative error message like "You must purchase this skill to use it."

3.  **Real-time UI Updates:**
    *   Ensure that when the payment verification poll succeeds (from Prompt 4), the frontend state is updated immediately.
    *   The `ownedSkills` set from Prompt 2 should be updated with the newly purchased skill name.
    *   The UI should automatically re-render, changing the "Purchase" button to an "Owned" badge without requiring a page reload.

## Code Example (Backend - Agent Runtime)
```javascript
// Inside the skill execution logic of the agent's brain

async function executeSkill(userId, agentId, skillName, args) {
    const skill = getSkillDefinition(skillName);
    if (!skill) {
        throw new Error('Skill not found.');
    }

    // Check if the skill is priced
    const priceInfo = await db.getSkillPrice(agentId, skillName);

    if (priceInfo) {
        // If it's a paid skill, verify ownership
        const hasAccess = await db.hasSkillAccess(userId, agentId, skillName);
        if (!hasAccess) {
            // Return a message to the user instead of throwing an error
            return {
                output: `You have not purchased the "${skillName}" skill. Please purchase it from the marketplace to use it.`,
                isError: true,
            };
        }
    }

    // --- If checks pass, proceed with skill execution ---
    return skill.execute(args);
}
```
