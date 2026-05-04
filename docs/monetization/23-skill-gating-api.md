---
status: not-started
---

# Prompt 23: Skill Gating (API Access Control)

## Objective
Implement a backend mechanism to "gate" the execution of paid skills, ensuring that only users who have purchased a skill can use it via the API.

## Explanation
Selling skills is only effective if their usage can be restricted to paying customers. This requires adding a check in the core agent interaction/chat API to verify ownership before executing a premium skill.

## Instructions
1.  **Identify the Skill Execution Endpoint:**
    *   Locate the primary backend API endpoint responsible for handling user chats or skill executions with an agent (e.g., `POST /api/chat`).

2.  **Modify the Endpoint Logic:**
    *   When a request comes in to execute a specific skill, the logic must first determine if the skill is free or paid.
    *   Perform a lookup in the `agent_skill_prices` table for the requested agent and skill.

3.  **Implement the Ownership Check:**
    *   **If the skill has a price**, the endpoint must then verify that the requesting user owns the skill.
    *   Perform a lookup in the `user_unlocked_skills` table for a record matching the `user_id`, `agent_id`, and `skill_name`.
    *   Alternatively, check if the user has an active subscription to the agent, as a subscription might grant access to all skills. This requires checking the `user_subscriptions` table.

4.  **Enforce Gating:**
    *   **If the skill is paid AND the user does NOT have a valid unlock record or active subscription**, the API must refuse to execute the skill.
    *   It should return a specific error response, e.g., a `402 Payment Required` status code, with a message like "You must purchase this skill to use it."
    *   **If the skill is free OR the user has purchased it**, the API should proceed with the normal skill execution logic.

## Code Example (Backend - Chat API Middleware/Check)

```javascript
// This function would be called inside your main chat/interaction endpoint
async function canUserExecuteSkill(userId, agentId, skillName) {
    // 1. Check if the skill is priced
    const price = await db.getSkillPrice(agentId, skillName);
    if (!price) {
        // It's a free skill
        return true;
    }

    // 2. If it's priced, check for direct ownership
    const hasUnlocked = await db.query(
        'SELECT 1 FROM user_unlocked_skills WHERE user_id = $1 AND agent_id = $2 AND skill_name = $3',
        [userId, agentId, skillName]
    );
    if (hasUnlocked.rowCount > 0) {
        return true;
    }

    // 3. Check for an active subscription that grants access (more advanced)
    const hasActiveSub = await db.query(
        `SELECT 1 FROM user_subscriptions s
         JOIN agent_subscription_tiers t ON s.tier_id = t.id
         WHERE s.user_id = $1 AND t.agent_id = $2 AND s.status = 'active'`,
        [userId, agentId]
    );
    if (hasActiveSub.rowCount > 0) {
        // Here you might have more granular logic, e.g., does this sub tier include this skill?
        // For now, we'll assume any active sub grants access.
        return true;
    }

    // 4. If all checks fail, user does not have access
    return false;
}

// --- Usage within the chat endpoint ---
// POST /api/chat
app.post('/api/chat', async (req, res) => {
    const { agentId, skillToExecute } = req.body;
    const userId = await getUserIdFromRequest(req);

    const hasAccess = await canUserExecuteSkill(userId, agentId, skillToExecute);

    if (!hasAccess) {
        return res.status(402).json({
            error: 'Payment Required',
            message: `You must purchase the skill "${skillToExecute}" to use it.`
        });
    }

    // ... proceed with normal skill execution logic ...
});
```
This logic ensures the economic loop is closed: creators define prices, users purchase access, and the system enforces that access, giving real value to the digital assets.
