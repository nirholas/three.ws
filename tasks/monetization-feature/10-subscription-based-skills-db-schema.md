---
status: not-started
---

# Prompt 10: Subscription-Based Skills (Part 1 - DB Schema)

**Status:** Not Started

## Objective
Update the database schema to support subscription-based pricing for skills (e.g., monthly access).

## Explanation
In addition to one-time purchases, we want to allow creators to sell skills as a recurring subscription. This requires changes to how we model pricing and access.

## Instructions
- [ ] **Modify the `agent_skill_prices` table.**
    - Add a `pricing_type` column (e.g., `one_time` or `subscription`).
    - Add a `renewal_period_days` column (e.g., 30 for monthly). This can be nullable if `pricing_type` is `one_time`.
- [ ] **Modify the `user_skill_access` table.**
    - Ensure the `expires_at` column exists. When a user buys a subscription, this will be set to `now() + renewal_period_days`.
- [ ] **Update the creator dashboard UI.**
    - When setting a price, allow creators to choose between "One-Time" and "Subscription".
    - If "Subscription" is chosen, show an input for the renewal period.
- [ ] **Update the API for saving prices** to handle these new fields.
