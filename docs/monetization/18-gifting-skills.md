---
status: not-started
---

# Prompt 18: Gifting Skills

## Objective
Allow users to purchase a skill and gift it to another user.

## Explanation
Gifting is a great way to encourage user engagement and introduce new users to the platform.

## Instructions
1.  **Update the UI:**
    *   Add a "Gift" option to the purchase modal.
    *   If selected, an input field will appear for the user to enter the recipient's wallet address or username.

2.  **Modify the Backend:**
    *   The payment processing endpoint will need to accept an optional `recipient_id`.
    *   When the purchase is recorded in the `user_skill_purchases` table, it will be associated with the recipient's user ID instead of the sender's.

3.  **Notifications:**
    *   Implement a notification system to inform the recipient that they have received a gift.
