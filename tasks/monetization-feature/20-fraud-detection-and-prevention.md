---
status: not-started
---

# Prompt 20: Backend - Fraud Detection and Prevention

## Objective
Implement basic security measures to detect and prevent common forms of abuse in the referral and payment systems.

## Explanation
Monetization features can attract fraudulent activity. Common schemes include users referring themselves with multiple accounts to farm rewards, or attackers attempting to find vulnerabilities in payment endpoints. Implementing basic preventative measures is crucial for protecting the platform's integrity and finances.

## Instructions
1.  **Rate Limiting on Critical Endpoints:**
    *   Ensure you have strict rate limiting on all monetization-related endpoints.
    *   Apply this to:
        *   `/api/auth/register`: Prevents rapid account creation.
        *   `/api/payments/solana-pay`: Prevents spamming transaction creation.
        *   `/api/payments/verify`: Prevents brute-force attacks.
    *   Use a library like `rate-limiter-flexible` and limit by IP address and/or user ID.

2.  **Prevent Self-Referrals:**
    *   In your referral commission logic (`Prompt 12`), add a check to ensure the purchaser's ID is not the same as their `referred_by_id`. While your signup logic should prevent this, a database constraint or an explicit check adds another layer of security.

3.  **Detect Multi-Accounting by IP:**
    *   When a user signs up (`/api/auth/register`), log their IP address.
    *   In the referral commission logic, before awarding a commission, check if the purchaser's signup IP address is the same as the referrer's signup IP address.
    *   If the IPs match, you can flag the transaction for manual review or automatically deny the commission. This helps prevent a user from "referring" themselves on the same device.

4.  **Database Constraints:**
    *   Add a `CHECK` constraint to your `users` table in the database to prevent a user's `id` from being the same as their `referred_by_id`.
    *   `ALTER TABLE users ADD CONSTRAINT no_self_referral CHECK (id <> referred_by_id);`

## Code Snippet (IP Check in Commission Logic)

```javascript
// Inside the referral commission logic...
const [purchaser] = await sql`
  SELECT referred_by_id, signup_ip FROM users WHERE id = ${purchaserId}
`;

if (purchaser && purchaser.referred_by_id) {
  const referrerId = purchaser.referred_by_id;

  const [referrer] = await sql`
    SELECT signup_ip FROM users WHERE id = ${referrerId}
  `;

  // Check if signup IPs are the same and not null
  if (purchaser.signup_ip && referrer.signup_ip && purchaser.signup_ip === referrer.signup_ip) {
    console.warn(`Potential self-referral detected for user ${purchaserId} and referrer ${referrerId}`);
    // Optionally, you can decide to not award the commission here
    return;
  }

  // ... proceed with awarding the commission
}
```
