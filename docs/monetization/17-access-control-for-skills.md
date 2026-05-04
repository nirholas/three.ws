# Prompt 17: Access Control for Skills

## Objective
Implement a robust access control layer on the backend to check if a user is permitted to use a specific skill before execution.

## Explanation
Now that users can buy skills or subscribe to tiers, we need to enforce access. Before executing any skill via the API, the backend must check if the skill is free or, if it's paid, whether the user has the right to use it. This is a critical security measure to protect creators' intellectual property.

## Instructions
1.  **Create an Access Control Middleware/Function:**
    *   It's best to centralize this logic. Create a helper function, e.g., `hasSkillAccess(userId, agentId, skillName)`.

2.  **Implement Access Logic:**
    *   The `hasSkillAccess` function will perform the following checks in order:
        1.  Check if the skill is priced in `agent_skill_prices`. If not, it's a free skill, so return `true`.
        2.  If the skill is priced, check if the user has a one-time purchase record for it in `user_purchased_skills`. If yes, return `true`.
        3.  If not purchased individually, check if the user has an active subscription (`user_subscriptions` table).
        4.  If they have a subscription, check if the `skillName` is in the `included_skills` array of their subscribed `agent_subscription_tiers`. If yes, return `true`.
        5.  If none of the above are true, return `false`.

3.  **Integrate into Skill Execution Endpoint:**
    *   Locate the main API endpoint responsible for executing agent skills (e.g., `/api/chat` or `/api/agent-actions.js`).
    *   Before running the skill logic, call your new `hasSkillAccess` function.
    *   If it returns `false`, the endpoint should immediately stop and return a 403 Forbidden error with a message like "You do not have access to this skill. Please purchase it from the marketplace."

## Code Example (Access Control Logic)

```javascript
// In a helper file, e.g., /api/_lib/access-control.js
import { supabase } from './supabase';

export async function hasSkillAccess(userId, agentId, skillName) {
    // 1. Check if the skill is free
    const { data: price, error: priceError } = await supabase
        .from('agent_skill_prices')
        .select('amount')
        .eq('agent_id', agentId)
        .eq('skill_name', skillName)
        .single();
    
    // If there's no price entry, it's considered free
    if (!price) return true;

    // User must be logged in to access priced skills
    if (!userId) return false;

    // 2. Check for a one-time purchase
    const { data: purchase, error: purchaseError } = await supabase
        .from('user_purchased_skills')
        .select('id')
        .eq('user_id', userId)
        .eq('agent_id', agentId)
        .eq('skill_name', skillName)
        .single();
        
    if (purchase) return true;

    // 3. Check for an active subscription that includes this skill
    const { data: subscription, error: subError } = await supabase
        .from('user_subscriptions')
        .select(`
            status,
            agent_subscription_tiers ( included_skills )
        `)
        .eq('user_id', userId)
        .eq('status', 'active')
        // We need to join through tiers to filter by agent
        // This query is simplified; a real one might need an RPC function
        // or a more complex join to link user_subscriptions -> tiers -> agents.
        .single(); // Assuming one active sub per user/agent for now

    if (subscription && subscription.agent_subscription_tiers.included_skills.includes(skillName)) {
        return true;
    }

    // 4. If all checks fail
    return false;
}
```
