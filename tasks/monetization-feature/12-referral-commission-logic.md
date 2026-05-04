---
status: not-started
---

# Prompt 12: Backend - Implement Referral Commission Logic

## Objective
Implement the backend logic to award a commission to the referrer when a referred user makes their first purchase.

## Explanation
This is the core of the referral program's value proposition. When a new user, brought in by a referrer, makes a purchase, the system must automatically calculate and credit a commission to the referrer. This process should be reliable and auditable.

## Instructions
1.  **Locate the Payment Verification Logic:**
    *   Find the part of your backend code that verifies a payment and unlocks a skill for a user (from "Prompt 6: Backend - Payment Verification"). This is likely in a file like `/api/payments/verify.js`.

2.  **Identify the Purchaser and Referrer:**
    *   Inside this logic, you have the `user_id` of the person making the purchase.
    *   Query the `users` table to check if this user has a `referred_by_id`.
    *   If `referred_by_id` is `null`, do nothing.

3.  **Check if it's the First Purchase:**
    *   To prevent awarding commissions on every purchase, you should typically only award it on the *first* purchase.
    *   Check your `user_purchased_skills` table to see if this user has any prior purchases. If they do, do not award a commission.

4.  **Calculate the Commission:**
    *   If there is a `referred_by_id` and this is the user's first purchase:
        *   Define the commission rate (e.g., 5% of the sale price). It's best to store this in a configuration file.
        *   Calculate the commission amount based on the `purchase_price`.

5.  **Record the Commission:**
    *   Insert a new entry into your `royalty_ledger` or a similar earnings table.
    *   This entry should be for the `referred_by_id` (the referrer).
    *   Clearly mark this earning as a "referral_commission".
    *   Update the `referral_earnings_total` on the referrer's `users` table row.

## Code Logic Snippet (in payment verification)

```javascript
// After successfully verifying a transaction and before inserting the purchase record...

const purchasePrice = ...; // price from the transaction
const purchaserId = ...; // ID of the user who paid

// 1. Get purchaser's referral info
const [purchaser] = await sql`
  SELECT referred_by_id FROM users WHERE id = ${purchaserId}
`;

if (purchaser && purchaser.referred_by_id) {
  const referrerId = purchaser.referred_by_id;

  // 2. Check if it's the first purchase for this user
  const [priorPurchases] = await sql`
    SELECT COUNT(*) as count FROM user_purchased_skills WHERE user_id = ${purchaserId}
  `;

  if (Number(priorPurchases.count) === 0) {
    // 3. Calculate and award commission
    const commissionRate = 0.05; // 5%
    const commissionAmount = purchasePrice * commissionRate;

    // 4. Record the commission in the ledger for the referrer
    await sql`
      INSERT INTO royalty_ledger (author_user_id, amount_usd, type, source_purchase_id, ...)
      VALUES (${referrerId}, ${commissionAmount}, 'referral_commission', ...);
    `;

    // 5. Update the total on the user's record
    await sql`
      UPDATE users
      SET referral_earnings_total = referral_earnings_total + ${commissionAmount}
      WHERE id = ${referrerId};
    `;
  }
}

// Now, proceed to insert the main purchase record for the buyer...
```
