---
status: not-started
last_updated: 2026-05-04
---
# Prompt 19: User Experience - Notifications for Sales

## Objective
Implement a system to notify creators in real-time or near-real-time when one of their skills is purchased.

## Explanation
A key part of a positive creator experience is immediate feedback on sales. We will build a notification system that alerts creators when they've made a sale. This could be an on-site notification, an email, or both.

## Instructions
1.  **Choose a Notification Channel:**
    *   **On-site:** A simple bell icon in the navigation that shows a red dot for new notifications. Clicking it reveals a dropdown of recent events.
    *   **Email:** Send a transactional email to the user's registered email address.
    *   For this task, we will focus on the backend logic to generate notifications, which can then be used for any channel.

2.  **Database Schema for Notifications:**
    *   Create a `notifications` table:
        *   `id`: Primary key.
        *   `user_id`: The user who receives the notification.
        *   `type`: An enum or text, e.g., `'SKILL_SALE'`.
        *   `payload`: A JSONB column with details about the event (e.g., `{ "skillName": "...", "price": 1.00, "buyerUsername": "..." }`).
        *   `is_read`: A boolean flag, default `false`.
        *   `created_at`: Timestamp.

3.  **Trigger Notification on Purchase:**
    *   In the `POST /api/skills/purchase-confirm` endpoint, after successfully verifying and recording a purchase, insert a new row into the `notifications` table.
    *   The `user_id` should be the ID of the agent's creator.

4.  **API to Fetch Notifications:**
    *   Create a new endpoint, `GET /api/notifications`.
    *   This endpoint should fetch all unread notifications for the currently authenticated user.
    *   It could also fetch a list of recent notifications (both read and unread).

5.  **API to Mark Notifications as Read:**
    *   Create an endpoint like `POST /api/notifications/mark-read`.
    *   This would update the `is_read` flag for specified notification IDs, so they no longer appear as "new."

## Code Example (Logic in `purchase-confirm` API)

```javascript
// ... after successfully inserting into user_purchased_skills

const [agentOwner] = await sql`
    SELECT user_id FROM agent_identities WHERE id = ${agent_id}
`;

if (agentOwner) {
    // Create a notification for the agent's creator
    await sql`
        INSERT INTO notifications (user_id, type, payload)
        VALUES (
            ${agentOwner.user_id},
            'SKILL_SALE',
            ${JSON.stringify({
                skillName: skill_name,
                agentId: agent_id,
                amount: expectedAmount,
                currency: currencyMint,
                buyerId: user.id,
                purchaseSignature: signature
            })}::jsonb
        )
    `;
}

// ... return success response
```
