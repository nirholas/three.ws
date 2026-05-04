---
status: not-started
last_updated: 2026-05-04
---
# Prompt 10: Enforcing Skill Ownership for API Usage

## Objective
Secure the agent's skill execution endpoint (`/api/chat` or similar) to prevent users from using paid skills they have not purchased.

## Explanation
Currently, the chat API likely allows any user to invoke any of an agent's skills. With paid skills, we must add an ownership check. Before executing a skill, the API needs to determine if the skill is free or, if it's paid, whether the calling user has purchased it.

## Instructions
1.  **Locate the Skill Execution Logic:**
    *   Find the API endpoint responsible for agent chat and skill execution. This is likely a central part of the application, possibly in `api/chat.js`.

2.  **Implement the Access Control Check:**
    *   Inside the handler, just before the point where a skill is about to be executed, insert the access control logic.
    *   **Step 1: Get Skill and User:**
        *   You'll have the `agent_id`, the `skill_name` being invoked, and the `user_id` from the session.
    *   **Step 2: Check if the Skill is Priced:**
        *   Query the `agent_skill_prices` table to see if a price is set for the `agent_id` and `skill_name`.
    *   **Step 3: Enforce Ownership:**
        *   If no price exists, the skill is free, and execution can proceed.
        *   If a price *does* exist, you must query the `user_purchased_skills` table to check for a record matching the `user_id`, `agent_id`, and `skill_name`.
        *   If a record exists, the user owns the skill. Proceed with execution.
        *   If no record exists, the user does not have access. Return a `403 Forbidden` error with a clear message like "You must purchase this skill to use it."

## Code Example (Inside the Chat/Skill Execution API)

```javascript
// This logic should be inserted before the skill execution block

const { agentId, skillName, userId } = /* ... from request context ... */;

// 1. Check if the skill has a price
const [skillPrice] = await sql`
    SELECT id FROM agent_skill_prices
    WHERE agent_id = ${agentId} AND skill_name = ${skillName}
`;

// If it has no price, it's free, so we can exit the check early
if (!skillPrice) {
    // Proceed with skill execution...
    return;
}

// 2. If it's priced, check if the user owns it
const [purchaseRecord] = await sql`
    SELECT id FROM user_purchased_skills
    WHERE user_id = ${userId} AND agent_id = ${agentId} AND skill_name = ${skillName}
`;

if (!purchaseRecord) {
    // User does NOT own the skill. Block execution.
    return error(res, 403, 'skill_not_owned', `Access denied. You must purchase the '${skillName}' skill to use it.`);
}

// 3. If we reach here, the user owns the skill.
// Proceed with skill execution...

```
