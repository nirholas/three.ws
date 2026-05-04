---
status: not-started
---

# Prompt 25: Affiliate and Referral System

## Objective
Implement a basic affiliate system where users can generate a unique referral link for an agent, and earn a commission on sales made through that link.

## Explanation
Referral systems are a powerful growth marketing tool. By rewarding users for promoting agents, we can incentivize word-of-mouth marketing and create a viral loop. This is an advanced feature that builds on the entire monetization stack.

## Instructions
1.  **Database Schema:**
    *   **`user_referral_codes`:**
        *   Columns: `id`, `user_id`, `code` (a unique, short string), `created_at`.
    *   **`referral_sales`:**
        *   Columns: `id`, `referral_code_id` (FK to `user_referral_codes`), `new_user_id` (the user who made the purchase), `transaction_signature`, `purchase_amount`, `commission_amount`, `payout_status` ('pending', 'paid'), `created_at`.

2.  **Referral Link Generation:**
    *   In the user's profile, provide a section to generate their unique referral code/link (e.g., `.../marketplace/agent/AGENT_ID?ref=USER_CODE`).
    *   Create a backend endpoint to generate and store a unique code for a user if they don't have one.

3.  **Tracking Referrals:**
    *   When a user lands on an agent page with a `?ref=` parameter in the URL, store the referral code in a client-side cookie that lasts for a reasonable time (e.g., 30 days).
    *   When a purchase is initiated, the frontend must pass the referral code from the cookie to the backend's transaction generation endpoint.

4.  **Modify Purchase Flow for Commission:**
    *   The backend transaction generation logic needs to be updated again.
    *   If a valid referral code is present for a purchase:
        *   Calculate the commission based on the sale amount (e.g., 10% of the platform fee, or a percentage of the total price).
        *   The main payment transaction should now be a three-way split: a portion to the creator, a portion to the platform treasury, and a portion to the referrer's wallet.
        *   **Important:** Adding a third transfer can complicate things. An alternative, simpler model is to have the platform collect the full fee and handle paying out commissions separately. For this prompt, let's assume the latter.

5.  **Recording Referral Sales:**
    *   After a referred purchase is verified, create a record in the `referral_sales` table.
    *   This logs the sale, the referrer, and the commission amount earned.

6.  **Referral Dashboard:**
    *   Create a simple dashboard for users to see:
        *   Their referral link.
        *   The number of clicks/sign-ups from their link.
        *   A list of sales they've generated.
        *   Their total pending commission and total paid-out commission.

## Simplified Payout Model
Instead of complex on-chain three-way splits, the backend will:
1.  Take the standard platform fee during the purchase.
2.  Log the commission owed to the referrer in `referral_sales`.
3.  Have a separate, offline or batch process to periodically pay out the "pending" commissions to the referrers. This is much easier to manage than multi-recipient on-chain transactions for every purchase.

This approach provides a robust foundation for a powerful growth engine, turning your users into a distributed sales force.
