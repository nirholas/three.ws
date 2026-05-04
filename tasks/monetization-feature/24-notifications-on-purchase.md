---
status: not-started
---
# Prompt 24: Purchase Notifications for Creators

**Status:** Not Started

## Objective
Implement a system to notify creators in real-time or via email when one of their skills is sold.

## Explanation
Instant feedback is highly motivating for creators. A notification system can encourage them to engage more with the platform and build more skills.

## Instructions
1.  **Choose a notification delivery method.** Options include:
    - WebSockets for real-time in-app notifications.
    - An email service (e.g., SendGrid, Mailgun) for email notifications.
2.  **Integrate the chosen service into your backend.**
3.  **Modify the purchase fulfillment endpoint (`/api/skills/fulfill_purchase` from Prompt 6).**
4.  **After successfully recording a purchase in the database, trigger the notification.**
    - Get the creator's user details (e.g., email address, or user ID for WebSocket targeting).
    - Send a notification with details like "Your skill '[Skill Name]' was just purchased!"

## Code Example (Backend - Conceptual Email Notification)
```javascript
// In fulfillPurchase, after the purchase is saved to DB
import { sendEmail } from './email-service';

// ...
await db.none('INSERT INTO skill_purchases ...');

// Get creator info
const skill = await db.one('SELECT name, creator_id FROM skills WHERE id = $1', skill_id);
const creator = await db.one('SELECT email FROM users WHERE id = $1', skill.creator_id);

// Send notification
await sendEmail({
    to: creator.email,
    subject: 'You made a sale!',
    body: `Congratulations! Your skill "${skill.name}" was just purchased on three.ws.`
});
// ...
```
This creates a positive feedback loop for creators.
