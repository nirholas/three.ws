---
status: not-started
---

# Prompt 18: Affiliate/Referral Program

**Status:** Not Started

## Objective
Implement a referral system where users can earn a commission for referring new buyers.

## Explanation
Referral programs are a great way to incentivize word-of-mouth marketing. A user can share a special link to an agent, and if someone makes a purchase through that link, the referrer gets a percentage of the sale.

## Instructions
- [ ] **Database Schema:**
    - Add a `referral_code` column to the `users` table.
    - Create a `referrals` table to track referral relationships (`referrer_id`, `referred_id`).
    - Add a `referred_by_user_id` column to the `skill_sales` table.
- [ ] **Generate Referral Links:** On the agent detail page, add a "Share" button that generates a unique referral link (e.g., `/marketplace/agent/ID?ref=USER_CODE`).
- [ ] **Track Referrals:** When a user lands on a page with a `ref` code, store it in their session or local storage. When they sign up or make a purchase, associate them with the referrer.
- [ ] **Modify the Purchase Transaction:**
    - If a sale was made through a referral, modify the transaction to include a third transfer for the referral commission.
    - Example: 1 USDC sale, 5% platform fee, 10% referral commission.
        - Buyer pays 1 USDC.
        - Creator gets 0.85 USDC.
        - Platform gets 0.05 USDC.
        - Referrer gets 0.10 USDC.
- [ ] **Update the Earnings Dashboards** for both creators and referrers to show referral income.
