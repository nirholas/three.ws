# Prompt 17: Affiliate and Referral Program

**Status:** - [ ] Not Started

## Objective
Design and implement an affiliate program where users can earn a commission for referring new customers who purchase skills.

## Explanation
A referral program can be a powerful growth engine. By rewarding users for promoting agents and skills, you can incentivize word-of-mouth marketing and expand the platform's reach.

## Instructions
1.  **Database Schema Changes:**
    *   Create a `referrals` table to track referral relationships.
        *   Columns: `id`, `referrer_user_id`, `referred_user_id`, `created_at`.
    *   Add a `referrer_user_id` column to the `user_agent_skills` table to link a purchase to a specific referral. This can be nullable.

2.  **Generate Unique Referral Links:**
    *   In the user's profile, provide a unique referral link (e.g., `three.ws/marketplace?ref=user_id`).
    *   When a new user signs up after visiting a referral link, store the referrer's ID in a cookie.
    *   When the new user signs up, read the cookie and create a record in the `referrals` table.

3.  **Attribute Purchases to Referrers:**
    *   When a user makes a purchase, the backend should check if they were referred.
    *   If so, populate the `referrer_user_id` in the `user_agent_skills` record.

4.  **Payout Logic for Referrers:**
    *   Modify the creator payout cron job (`/api/cron/process-payouts.js`) or smart contract.
    *   When processing a sale that has a referrer, the payment needs to be split three ways: creator, platform, and referrer.
    *   Define the commission rates (e.g., 5% for the referrer).

5.  **Referral Dashboard for Users:**
    *   Create a section in the user's dashboard to track their referrals.
    *   Display stats like number of sign-ups from their link, number of purchases made by their referrals, and total commission earned.

## Code Example (Conceptual - Purchase Endpoint Modification)

```javascript
// In /api/marketplace/purchase-skill.js
export default async function handler(req, res) {
  const userId = req.user.id;
  // ...

  // Check for a referrer ID, which might be stored in the user's session
  // or looked up from the 'referrals' table.
  const referrerId = await db.findReferrerForUser(userId);

  // ... (Transaction verification logic)

  if (verificationSuccess) {
    // Pass referrerId when recording the purchase
    await db.recordSkillPurchase(userId, agentId, skillName, referrerId);
    // ...
  }
}
```

## Code Example (Conceptual - Payout Logic Modification)

```javascript
// In the payout cron job
for (const purchase of pendingPurchases) {
  const creatorBase = purchase.amount * (1 - PLATFORM_FEE_PERCENT / 100);
  let creatorShare = creatorBase;

  if (purchase.referrer_id) {
    const referrerCommission = purchase.amount * (REFERRAL_COMMISSION_PERCENT / 100);
    creatorShare -= referrerCommission;
    
    // Add to referrer's payout
    const referrer = await db.getUser(purchase.referrer_id);
    payouts[referrer.wallet_address] = (payouts[referrer.wallet_address] || 0) + referrerCommission;
  }
  
  // Add to creator's payout
  payouts[purchase.creator_address] = (payouts[purchase.creator_address] || 0) + creatorShare;
}
```
