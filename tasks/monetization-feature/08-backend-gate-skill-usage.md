---
status: not-started
---

# Prompt 8: Gate Skill Usage on Backend

**Status:** Not Started

## Objective
Modify the agent action/chat endpoint to verify that a user owns a paid skill before allowing its execution.

## Explanation
This is the core enforcement mechanism. When a user tries to use a skill (e.g., via a chat command), the backend must check two things: 1) if the skill is a paid skill, and 2) if the user has purchased it. If it's a paid skill and the user hasn't bought it, the request should be denied with an appropriate message.

## Instructions
- [ ] **Locate the main agent action endpoint** (e.g., `/api/chat.js` or `/api/agent-actions.js`).
- [ ] **Modify the Logic:**
    - [ ] When a request to execute a skill comes in, get the `agentId`, `skillName`, and the authenticated `userId`.
    - [ ] First, query `agent_skill_prices` to see if the requested `(agentId, skillName)` has a price.
    - [ ] If it does not have a price, it's a free skill, so proceed with execution as normal.
    - [ ] If it *does* have a price, you must then query the `skill_purchases` table to see if a record exists for `(userId, agentId, skillName)`.
    - [ ] If a purchase record exists, proceed with execution.
    - [ ] If no purchase record exists, return an error response (e.g., HTTP 402 Payment Required).
- [ ] **Optimize the query:** You can combine these checks into a single, more efficient SQL query.

## Code Example (Conceptual Node.js in `/api/chat.js`)

```javascript
// ... inside the chat handler, before executing the skill ...

const { agentId, skillName, ... } = req.body;
const user = await getSessionUser(req);

// Check if the skill is priced
const [priceInfo] = await sql`SELECT amount FROM agent_skill_prices WHERE agent_id = ${agentId} AND skill_name = ${skillName}`;

if (priceInfo) {
    // It's a paid skill, now check for ownership
    if (!user) {
        return res.status(402).json({ error: 'This is a premium skill. Please sign in to purchase.' });
    }

    const [purchase] = await sql`
        SELECT id FROM skill_purchases
        WHERE user_id = ${user.id} AND agent_id = ${agentId} AND skill_name = ${skillName}`;

    if (!purchase) {
        return res.status(402).json({ error: `You must purchase the '${skillName}' skill to use it.` });
    }
}

// If we reach here, the user is authorized to use the skill.
// ... proceed to execute the skill ...
```
