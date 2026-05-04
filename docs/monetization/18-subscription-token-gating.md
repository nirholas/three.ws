# Prompt 18: Subscription Token Gating

## Objective
Gate agent and skill access based on a user's subscription status.

## Explanation
Similar to gating individual skills with NFT ownership, this prompt applies the same principle to subscriptions. If an agent offers subscriptions, users with an active subscription should get access to all of its paid skills.

## Instructions
1.  **Create Subscription Status Endpoint:**
    *   Create a new backend endpoint, e.g., `/api/subscriptions/status`.
    *   It should take an `agent_id` and `user_id` (from session) as input.
    *   The endpoint queries the `user_subscriptions` table to check if there is an 'active' subscription for that user and agent, where the `end_date` is in the future.
    *   It should return a simple JSON response, like `{ "is_subscribed": true, "tier": "Pro" }`.

2.  **Modify Skill Gating Logic:**
    *   Update the `tryUseSkill` function from Prompt 9.
    *   Before checking for individual NFT ownership for a paid skill, first check if the user has an active subscription to the agent.
    *   Call the new `/api/subscriptions/status` endpoint.
    *   If the user `is_subscribed`, grant them access to the skill immediately, bypassing the NFT check.

3.  **Update UI Based on Subscription:**
    *   On the agent detail page, if a user is already subscribed, the "Unlock" buttons for skills should be hidden or changed to "Use".
    *   The "Subscribe" buttons for tiers should be replaced with a message like "You are currently subscribed to the Pro plan."

## Code Example (Backend Status Endpoint)
```javascript
async function getSubscriptionStatus(req, res) {
    const userId = req.session.userId;
    const { agent_id } = req.query;

    const result = await db.query(
        `SELECT * FROM user_subscriptions
         WHERE user_id = $1 AND agent_id = $2 AND status = 'active' AND end_date > NOW()`,
        [userId, agent_id]
    );

    if (result.rows.length > 0) {
        res.status(200).json({ is_subscribed: true });
    } else {
        res.status(200).json({ is_subscribed: false });
    }
}
```
