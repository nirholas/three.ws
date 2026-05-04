# Prompt 21: Affiliate/Referral System

## Objective
Design and implement a basic affiliate system where users can earn a commission for referring new users who purchase agent skills.

## Explanation
A referral system can be a powerful growth engine. This feature will allow users to generate a unique referral code. When a new user signs up using this code and makes a purchase, the original user (the affiliate) will receive a percentage of the sale. This incentivizes word-of-mouth marketing.

## Instructions
1.  **Database Schema:**
    *   Add a `referral_code` column to the `users` table.
    *   Add a `referred_by` column (nullable foreign key to `users.id`) to the `users` table.
    *   Create a `referral_payouts` table to track commissions earned.

2.  **UI for Affiliates:**
    *   In the user's dashboard, add a new "Affiliate" section.
    *   Display the user's unique referral link (e.g., `three.ws/register?ref=CODE`).
    *   Show stats: number of sign-ups, total purchase volume from referrals, and commission earned.

3.  **Backend Logic:**
    *   **Registration:** When a user registers, check for a `ref` query parameter. If present and valid, store the referrer's user ID in the new user's `referred_by` column.
    *   **Purchase:** When a skill purchase is successfully verified, check if the purchaser was referred by someone.
    *   **Commission:** If they were, calculate the commission (e.g., 5% of the sale price) and create a record in the `referral_payouts` table for the affiliate.
    *   **Payouts:** Create a system (initially can be manual) for paying out earned commissions to affiliates' wallets.

## Database Schema Changes

```sql
-- Add columns to your user table (e.g., auth.users)
ALTER TABLE auth.users
ADD COLUMN referral_code TEXT UNIQUE,
ADD COLUMN referred_by UUID REFERENCES auth.users(id);

-- Initialize existing users with a referral code
-- (Requires a function to generate unique codes)

-- Table to track commissions
CREATE TABLE affiliate_earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_user_id UUID REFERENCES auth.users(id) NOT NULL,
    originating_purchase_id UUID REFERENCES user_purchased_skills(id) NOT NULL,
    commission_amount BIGINT NOT NULL,
    commission_currency_mint TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Code Example (Purchase Verification Snippet)

```javascript
// Inside /api/marketplace/skills/verify-purchase.js
// After the purchase has been successfully recorded...

const { data: purchaser } = await supabase
    .from('users') // or auth.users
    .select('referred_by')
    .eq('id', userId)
    .single();

if (purchaser && purchaser.referred_by) {
    const affiliateId = purchaser.referred_by;
    const saleAmount = /* get price of the skill just sold */;
    const commissionRate = 0.05; // 5%
    const commissionAmount = Math.round(saleAmount * commissionRate);

    if (commissionAmount > 0) {
        await supabase.from('affiliate_earnings').insert({
            affiliate_user_id: affiliateId,
            originating_purchase_id: newlyCreatedPurchaseRecord.id,
            commission_amount: commissionAmount,
            commission_currency_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6d' // USDC
        });
    }
}
```
