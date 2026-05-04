---
status: not-started
---

# Prompt 23: User Notifications

**Status:** Not Started

## Objective
Implement a notification system to inform users about successful purchases and to inform creators about sales.

## Explanation
Notifications are a key part of a good user experience. A user should get a clear confirmation that their purchase was successful, and a creator should be excited to learn they've made a sale.

## Instructions
- [ ] **Create a `notifications` Database Table:**
    - [ ] The table should store `user_id`, a `message`, a `read` status (boolean), a `link`, and a `created_at` timestamp.
- [ ] **Backend - Generate Notifications:**
    - [ ] In the payment confirmation endpoint (from Prompt 6), after successfully recording a purchase in `skill_purchases`, insert two new rows into the `notifications` table:
        1.  One for the **buyer**, with a message like "You successfully purchased the skill 'X' for agent 'Y'." The link should go to the agent's page.
        2.  One for the **creator** (the agent's `user_id`), with a message like "You made a sale! User 'Z' bought your skill 'X'." The link could go to their earnings dashboard.
- [ ] **Frontend - Display Notifications:**
    - [ ] Create a new API endpoint `GET /api/notifications` that fetches the user's unread notifications.
    - [ ] In the main application layout, add a notification bell icon.
    - [ ] When the page loads, call the new endpoint. If there are unread notifications, show a badge on the bell icon.
    - [ ] When the user clicks the icon, display the notifications in a dropdown menu.

## Code Example (Backend Notification Insert)

```sql
-- After inserting into skill_purchases...
-- The buyer is `user.id`, the creator is `agent.user_id`

-- Notification for the buyer
INSERT INTO notifications (user_id, message, link)
VALUES (${buyerId}, 'You successfully purchased skill ${skillName}.', '/marketplace/agent/${agentId}');

-- Notification for the creator
INSERT INTO notifications (user_id, message, link)
VALUES (${creatorId}, 'You sold your skill ${skillName}!', '/agent/edit/${agentId}/monetization');
```
