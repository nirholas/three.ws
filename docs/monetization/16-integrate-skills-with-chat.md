# Prompt 16: Integrate Owned Skills with Agent Chat

## Objective
Modify the agent chat backend to check if a user owns the required skill before allowing the execution of a premium agent capability.

## Explanation
Monetization is only effective if owning a skill actually unlocks functionality. This task connects the ownership record to the agent's core logic. When an agent is about to perform an action tied to a paid skill, it must first verify that the interacting user has purchased that skill.

## Instructions
1.  **Map Agent Actions to Skills (Backend):**
    *   You need a way to associate specific agent behaviors with skill names. This could be done in your agent's configuration or a database table. For example, a `run_market_analysis` action might require the `MarketAnalysis` skill.

2.  **Create a Skill Check Middleware/Function (Backend):**
    *   In your chat API (`api/chat.js` or similar), create a function `checkSkillOwnership(userId, agentId, requiredSkill)`.
    *   This function will query the `user_skill_ownership` table to see if a record exists for the given user, agent, and skill.
    *   It should return `true` or `false`.

3.  **Enforce the Check (Backend):**
    *   In your main chat message handler, before executing a premium action:
        *   Identify the skill required for the action.
        *   Call your `checkSkillOwnership` function.
        *   If the check fails, do not execute the action. Instead, return a specific response to the frontend indicating the required skill is not owned.

## Code Example (Backend - Chat API)

```javascript
import { checkSkillOwnership } from '../_lib/db'; // Your new DB function
import { getSkillForAction } from '../_lib/agent-config'; // Function to map action to skill

export default async function handler(req, res) {
    // ... (chat handler setup, get user message and user id)
    const userId = req.user.id;
    const { agentId, message } = req.body;

    // 1. Determine the agent's intended action based on the message
    const action = determineAgentAction(message); 
    
    // 2. Look up the skill required for this action
    const requiredSkill = getSkillForAction(agentId, action);

    if (requiredSkill) {
        // 3. This is a premium action, so check for ownership
        const hasSkill = await checkSkillOwnership(userId, agentId, requiredSkill);

        if (!hasSkill) {
            // 4. If user doesn't own it, send a specific response
            return res.status(402).json({ // 402 Payment Required
                type: 'skill_required',
                message: `This action requires the "${requiredSkill}" skill. Please purchase it from the marketplace to continue.`,
                skillName: requiredSkill,
            });
        }
    }

    // If we reach here, the user either has the skill or the action is free.
    // Proceed with executing the agent's action.
    const agentResponse = await executeAgentAction(agentId, action, message);

    res.status(200).json({ response: agentResponse });
}
```

## Database Function (`_lib/db.js`)

```javascript
export async function checkSkillOwnership(userId, agentId, skillName) {
    const { rowCount } = await db.query(
        `
        SELECT 1 FROM user_skill_ownership
        WHERE user_id = $1 AND agent_id = $2 AND skill_name = $3;
        `,
        [userId, agentId, skillName]
    );
    return rowCount > 0;
}
```
