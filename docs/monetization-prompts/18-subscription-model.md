# Prompt 18: Skill Subscription Model

**Status:** - [ ] Not Started

## Objective
Implement a subscription model where users can pay a recurring fee for access to a set of skills from a creator, or all skills on the platform.

## Explanation
Subscriptions provide a predictable revenue stream for creators and the platform. This model can be attractive to power users who want access to a wide range of premium skills without making individual purchases. This could be implemented using a system like Solana Pay or by integrating with a dedicated NFT subscription service.

## Instructions
1.  **Database Schema for Subscriptions:**
    *   Create a `subscriptions` table:
        *   Columns: `id`, `user_id`, `subscription_tier_id`, `start_date`, `end_date`, `status` (e.g., 'active', 'cancelled').
    *   Create a `subscription_tiers` table:
        *   Columns: `id`, `creator_id` (nullable, for creator-specific tiers), `name`, `price`, `currency_mint`, `duration_days`.

2.  **UI for Subscribing:**
    *   Create a new "Subscriptions" page.
    *   Display available subscription tiers (e.g., "Pro Tier - All Skills", "Creator X's All-Access Pass").
    *   Add a "Subscribe" button for each tier.

3.  **Handle Recurring Payments:**
    *   This is the most complex part. On-chain recurring payments on Solana are not as straightforward as with traditional payment systems.
    *   **Option 1: Solana Pay.** Integrate with Solana Pay to allow users to approve recurring transactions. This still requires user action for each payment period.
    *   **Option 2: Subscription-as-an-NFT.** A user mints an NFT that represents their subscription. The NFT has an expiration date. The dApp checks for a valid (non-expired) subscription NFT in the user's wallet. The user has to manually "renew" by purchasing a new subscription NFT.
    *   **Option 3: Off-chain with Credit Card.** For a hybrid model, use a service like Stripe for recurring billing and then have the backend airdrop a subscription NFT to the user.

4.  **Update Skill Gating Logic:**
    *   Modify the skill gating logic from Prompt 14.
    *   Before denying access to a paid skill, the system must also check if the user has an active subscription that grants access to that skill.
    *   This check involves looking for a valid record in the `subscriptions` table or a valid subscription NFT in the user's wallet.

## Code Example (Conceptual - Skill Gating Update)

```javascript
// In the backend skill execution endpoint
// ... (after checking for a price)

if (skillPrice) {
  // Check for direct ownership first
  const hasOwnership = await db.checkSkillOwnership(userId, agentId, skillName);
  
  if (!hasOwnership) {
    // If not owned directly, check for an active subscription
    const hasActiveSub = await db.checkActiveSubscription(userId, agentId, skillName);
    
    if (!hasActiveSub) {
      return res.status(403).json({ error: 'Subscription or purchase required.' });
    }
  }
}

// Proceed with execution
// ...
```
