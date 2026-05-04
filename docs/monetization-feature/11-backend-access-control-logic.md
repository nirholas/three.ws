---
status: not-started
---

# Prompt 11: Backend - Logic for Access Control

**Status:** Not Started

## Objective
Implement backend logic to restrict access to paid skills to only those users who have purchased them.

## Explanation
Currently, the API that executes a skill doesn't check for ownership. This means anyone could use a paid skill without paying for it. We need to add an access control layer to the skill execution endpoint. This is a critical security and functionality step for our monetization feature.

## Instructions
1.  **Identify the skill execution endpoint:**
    - Find the API endpoint responsible for running an agent's skills. This might be a general-purpose chat or agent interaction endpoint (e.g., `/api/chat`).

2.  **Add an ownership check:**
    - Inside this endpoint, before executing a skill, determine if the skill is a paid one.
    - To do this, check the `agent_skill_prices` table for the `agent_id` and `skill_name`.
    - If the skill has a price, you must then check if the user has purchased it.
    - Query the `user_skill_purchases` table for a record matching the `user_id`, `agent_id`, and `skill_name`.

3.  **Enforce access control:**
    - If the skill is paid and no purchase record is found for the user, return a `403 Forbidden` or `402 Payment Required` error.
    - The error message should inform the user that they need to purchase the skill to use it.
    - If the skill is free or if the user has purchased it, proceed with executing the skill as normal.

## Code Example (in the skill execution endpoint)

```javascript
// In your skill execution endpoint (e.g., /api/chat)

export default async function handler(req, res) {
  // ... existing code to get agent, user, and the skill to be executed ...

  const { agentId, skillName, userId } = /* ... from your request context ... */;

  // 1. Check if the skill is priced
  const priceResult = await db.query(
    'SELECT id FROM agent_skill_prices WHERE agent_id = $1 AND skill_name = $2',
    [agentId, skillName]
  );

  const isPaidSkill = priceResult.rows.length > 0;

  if (isPaidSkill) {
    // 2. If it's a paid skill, check for a purchase record
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required for this skill' });
    }
    
    const purchaseResult = await db.query(
      'SELECT id FROM user_skill_purchases WHERE user_id = $1 AND agent_id = $2 AND skill_name = $3',
      [userId, agentId, skillName]
    );

    const hasPurchased = purchaseResult.rows.length > 0;

    // 3. Enforce access control
    if (!hasPurchased) {
      return res.status(402).json({
        error: 'Payment Required',
        message: `You must purchase the skill "${skillName}" to use it.`,
      });
    }
  }

  // If we reach here, the user has access. Proceed with skill execution.
  const skillResult = await executeSkill(agentId, skillName, /* ... other params ... */);

  res.status(200).json({ result: skillResult });
}
```

## Verification
- Seed your database with a paid skill for an agent, but do *not* create a purchase record for your test user.
- Try to use that paid skill via the API or your application's UI.
- Verify that you receive a `402` or `403` error and a message informing you that the skill must be purchased.
- Now, manually insert a purchase record for your user in the `user_skill_purchases` table.
- Try to use the skill again.
- Verify that the skill now executes successfully.
- Also, test a free skill to ensure that the access control logic doesn't block it.
