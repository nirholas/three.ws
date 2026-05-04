---
status: not-started
---

# Prompt 11: Subscription-Based Skills (Part 2 - Access Logic)

**Status:** Not Started

## Objective
Update the skill access control logic to handle subscriptions.

## Explanation
Now that we can store subscription prices, we need to enforce access based on whether a user's subscription is active.

## Instructions
- [ ] **Modify the skill purchase logic.**
    - When a user buys a subscription skill, in the `user_skill_access` table, set `expires_at` to the correct future date.
- [ ] **Modify the skill access control check (`/api/agent/invoke`).**
    - When checking for access in the `user_skill_access` table:
        - If the skill is a subscription, you must also check that `expires_at` is in the future.
        - `WHERE user_id = ? AND skill_name = ? AND expires_at > NOW()`
- [ ] **Update the UI to show subscription status.**
    - On the agent detail page, if a user owns a subscription, show "Subscribed" and the expiry date instead of a "Buy" button.
    - If a subscription is expired, show a "Renew" button.
- [ ] **Implement the renewal logic.** The "Renew" button should trigger the same purchase flow, which will update the `expires_at` date.
