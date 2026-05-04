---
status: not-started
---
# Prompt 15: Backend Logic for Skill Unlocking

**Status:** Not Started

## Objective
Modify the backend logic to ensure that an agent can only use/execute skills that are either free or have been purchased for it.

## Explanation
This is the enforcement part of the monetization feature. When an agent is about to perform an action using a skill, the backend must first verify access rights. This prevents users from using paid skills without paying for them.

## Instructions
1.  **Locate the core agent logic where a skill is executed.** This might be in a chat processing loop or an action handler.
2.  **Before executing a skill, perform an access check:**
    - **Get the skill's pricing information.** You'll need to query the `agent_skill_prices` table.
    - **If the skill is not in the pricing table, it's free.** Allow execution.
    - **If the skill has a price, it's a paid skill.** You must check if a valid purchase record exists.
    - **Query the `skill_purchases` table** for a row matching the current `agent_id` and the `skill_id`.
    - **If a purchase record exists, allow execution.**
    - **If no purchase record exists, block execution** and return an error message to the user (e.g., "This agent has not purchased the '[skill name]' skill.").

## Code Example (Conceptual backend logic)
```javascript
async function executeSkill(agent, skillName, user) {
    const skill = await getSkillByName(skillName);
    
    // Check if the skill is priced
    const priceInfo = await db.query('SELECT id FROM agent_skill_prices WHERE skill_id = $1', [skill.id]);

    if (!priceInfo) {
        // Skill is free, proceed
        return skill.execute(agent);
    }

    // Skill is paid, check for purchase
    const purchase = await db.query(`
        SELECT id FROM skill_purchases 
        WHERE agent_id = $1 AND skill_id = $2
    `, [agent.id, skill.id]);

    if (!purchase) {
        throw new Error(`Access denied. The skill '${skillName}' must be purchased for this agent.`);
    }

    // Access granted, proceed
    return skill.execute(agent);
}
```
