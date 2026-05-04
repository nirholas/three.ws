# Prompt 2: API for Creators to Set Skill Prices

## Objective
Create a secure API endpoint for agent creators to set, update, and remove prices for their skills.

## Explanation
To enable monetization, creators need a way to manage the prices of their skills. This endpoint will allow them to programmatically define which skills are paid and how much they cost. It must be secure, ensuring only the agent's owner can modify prices.

## Instructions
1.  **Create API Route:**
    *   Set up a new route: `POST /api/agents/:id/skills/price`.
    *   This route should handle setting or updating the price for a single skill.

2.  **Authentication and Authorization:**
    *   Protect this endpoint. Ensure that a user is authenticated.
    *   Verify that the authenticated user is the owner of the agent specified by `:id`. If not, return a `403 Forbidden` error.

3.  **Request Body Validation:**
    *   The request body should be a JSON object with the following structure:
        ```json
        {
          "skill_name": "your-skill-name",
          "amount": 1000000,
          "currency_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        }
        ```
    *   Validate the `skill_name`, `amount` (must be a non-negative integer), and `currency_mint`.

4.  **Database Interaction:**
    *   Implement logic to "upsert" this data into the `agent_skill_prices` table.
    *   If a price for that `agent_id` and `skill_name` already exists, update it.
    *   If it doesn't exist, insert a new row.
    *   If `amount` is `0` or `null`, you should delete the corresponding row from `agent_skill_prices` to make the skill free again.

5.  **Response:**
    *   On success, return a `200 OK` status with a confirmation message.
    *   On failure (validation, auth, etc.), return an appropriate error status and message.

## Code Example (Backend - `api/agents/[id]/skills/price.js`)

```javascript
// Example using an Express-like framework

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { id: agentId } = req.query;
  const { skill_name, amount, currency_mint } = req.body;
  
  // 1. Get authenticated user (e.g., from a session or token)
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 2. Verify ownership of the agent
  const agent = await db.getAgentById(agentId);
  if (!agent || agent.creator_id !== user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // 3. Validate input
  if (!skill_name || !currency_mint || amount == null || amount < 0) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  try {
    // 4. Upsert or delete price in the database
    if (amount > 0) {
      await db.upsertSkillPrice({ agent_id: agentId, skill_name, amount, currency_mint });
    } else {
      await db.deleteSkillPrice({ agent_id: agentId, skill_name });
    }
    
    // 5. Return success
    res.status(200).json({ message: 'Skill price updated successfully.' });
  } catch (error) {
    console.error('Error updating skill price:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
```
