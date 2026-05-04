# Prompt 23: Email and In-App Notifications

## Objective
Implement a notification system to alert users and creators about important monetization events, such as a new sale or a subscription renewal.

## Explanation
To create an engaging user experience, the platform should proactively inform users about events relevant to them. For creators, a "You've made a sale!" notification is highly motivating. For users, a receipt or a reminder about an upcoming subscription renewal is essential. This task involves setting up the infrastructure for both in-app and email notifications.

## Instructions
1.  **Choose a Notification Service:**
    *   For emails, we can integrate a transactional email service like Resend, SendGrid, or Postmark.
    *   For in-app notifications, we'll create a new database table and a UI component.

2.  **Database Schema for In-App Notifications:**
    *   Create a `notifications` table.
    *   Columns: `id`, `user_id` (who the notification is for), `type` (e.g., 'sale_made', 'skill_purchased'), `message`, `is_read`, `link_url` (e.g., link to the transaction), `created_at`.

3.  **Backend Integration:**
    *   In the backend logic where monetization events occur (e.g., in `verify-purchase.js`), add calls to a new notification helper function.
    *   This function, `createNotification(userId, type, data)`, will:
        *   Insert a record into the `notifications` table.
        *   (Optional) Trigger an email to be sent via the chosen email service.

4.  **Frontend UI:**
    *   Add a "notification bell" icon to the main site header.
    *   When clicked, it should show a dropdown or a dedicated page listing the user's unread notifications, fetched from a new `/api/notifications` endpoint.
    *   Clicking a notification should mark it as read and, if it has a `link_url`, navigate the user there.

## Code Example (Backend Notification Trigger)

```javascript
// /api/_lib/notifications.js
import { supabase } from './supabase';
// import { Resend } from 'resend';
// const resend = new Resend(process.env.RESEND_API_KEY);

export async function createSaleNotification(purchase) {
    // Notify the creator
    const creatorMessage = `You sold the skill "${purchase.skillName}" for agent "${purchase.agentName}"!`;
    await supabase.from('notifications').insert({
        user_id: purchase.creatorId,
        type: 'sale_made',
        message: creatorMessage,
        link_url: `/marketplace/agents/${purchase.agentId}`
    });
    // await resend.emails.send({ ... });

    // Notify the buyer
    const buyerMessage = `You successfully purchased the skill "${purchase.skillName}".`;
    await supabase.from('notifications').insert({
        user_id: purchase.buyerId,
        type: 'skill_purchased',
        message: buyerMessage,
        link_url: `/users/me/library`
    });
    // await resend.emails.send({ ... }); // Send receipt
}

// In /api/marketplace/skills/verify-purchase.js
// After successfully verifying and recording a purchase...
import { createSaleNotification } from '../../_lib/notifications';

await createSaleNotification({
    creatorId: agent.creator_id,
    buyerId: userId,
    skillName: skillName,
    agentName: agent.name,
    agentId: agentId,
});
```
