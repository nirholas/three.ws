---
status: not-started
---

# Prompt 19: Skill Usage Gating

## Objective
Implement the core logic that prevents users from using a paid skill unless they have successfully purchased it.

## Explanation
This is where monetization becomes functional. So far, we can sell skills, but there's nothing stopping a user from trying to use them anyway. This "gating" logic must be enforced on the backend to be secure.

## Instructions
- [ ] **Locate the Skill Execution Logic:**
    - [ ] Find the part of your backend code that is responsible for executing an agent's skill. This might be in a chat API, a general agent interaction endpoint, or a dedicated skill execution endpoint.

- [ ] **Add a Pre-Execution Check:**
    - [ ] Before the skill's code is run, insert a new checking mechanism.
    - [ ] This check needs to know which user is making the request, which agent is being used, and which skill is being invoked.

- [ ] **Perform Ownership Verification:**
    - [ ] Inside the check, first determine if the skill in question is a paid skill. Query the `agent_skill_prices` table for the agent and skill name.
    - [ ] If the skill is **not** in the prices table, it's free. Allow execution to proceed.
    - [ ] If the skill **is** in the prices table, it's a paid skill. You must now query the `unlocked_skills` table.
    - [ ] Check if a row exists in `unlocked_skills` for the current `user_id`, `agent_id`, and `skill_name`.
    - [ ] **If a row exists**, the user owns the skill. Allow execution to proceed.
    - [ ] **If no row exists**, the user does not own the skill. Block the execution and return an error message to the user, e.g., `402 Payment Required`, with a message like "You must purchase this skill to use it."

## Code Example (Backend Skill Execution Endpoint)

```javascript
// Example of an endpoint that runs a skill
export default async function handler(req, res) {
    // Assume auth middleware has run and req.user is available
    const { agentId, skillName, skillInputs } = req.body;
    const userId = req.user.id;

    // --- NEW GATING LOGIC ---
    // 1. Check if the skill is priced
    const price = await db.getSkillPrice(agentId, skillName);
    
    if (price) {
        // It's a paid skill, so check for ownership
        const isOwned = await db.checkSkillOwnership(userId, agentId, skillName);
        if (!isOwned) {
            return res.status(402).json({ 
                message: `This is a paid skill. Please purchase it from the marketplace to use it.` 
            });
        }
    }
    // --- END OF GATING LOGIC ---

    // If the logic reaches here, the user is allowed to proceed.
    // Original skill execution logic follows:
    try {
        const result = await executeSkill(agentId, skillName, skillInputs);
        res.status(200).json({ result });
    } catch (error) {
        res.status(500).json({ message: "Skill execution failed." });
    }
}
```
