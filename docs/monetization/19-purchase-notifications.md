# Prompt 19: Purchase Confirmation Notifications

## Objective
After a successful skill purchase, send a confirmation to the user, either via an in-app notification, an email, or both.

## Explanation
Providing post-purchase confirmation is a standard practice that builds user trust and keeps them informed. An in-app notification provides immediate feedback, while an email serves as a permanent receipt. This task involves setting up a notification system and triggering it after a purchase is confirmed.

## Instructions
1.  **Choose a Notification System:**
    *   **In-app:** You can build a simple notification system with a database table (`notifications`) and a UI element in the site header that shows a notification count.
    *   **Email:** Integrate with an email service provider like SendGrid, Postmark, or Resend.

2.  **Create a Notification Service (Backend):**
    *   Create a new module, e.g., `services/notifications.js`.
    *   This service will have a function, e.g., `sendPurchaseConfirmation(userId, purchaseDetails)`.
    *   This function will contain the logic to either:
        *   Insert a new row into the `notifications` table in your database.
        *   Or, make an API call to your chosen email service provider to send a templated email.

3.  **Integrate into Purchase Flow (Backend):**
    *   In your payment confirmation endpoint (`api/payments/prepare-skill-purchase.js`), after you have verified the transaction and granted the skill, call your new `sendPurchaseConfirmation` function.
    *   Pass all the necessary details, such as the user's information (for their email address), the skill name, agent name, and price paid.

## Code Example (Backend - Notification Service using Resend)

```javascript
// services/notifications.js
import { Resend } from 'resend';
import { findUserById } from '../_lib/db'; // DB function to get user details

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendPurchaseConfirmationEmail(userId, details) {
    try {
        const user = await findUserById(userId);
        if (!user || !user.email) {
            console.warn(`Cannot send email: User ${userId} not found or has no email.`);
            return;
        }

        await resend.emails.send({
            from: 'noreply@three.ws',
            to: user.email,
            subject: 'Your Skill Purchase Confirmation',
            html: `
                <h1>Purchase Confirmed!</h1>
                <p>Hi ${user.name || 'there'},</p>
                <p>You have successfully purchased the skill "<strong>${details.skillName}</strong>" for the agent "<strong>${details.agentName}</strong>".</p>
                <p><strong>Price:</strong> ${(details.amount / 1e6).toFixed(2)} USDC</p>
                <p>Thank you for your purchase!</p>
            `,
        });
    } catch (error) {
        console.error('Failed to send purchase confirmation email:', error);
    }
}
```

## Integration into Payment Endpoint

```javascript
// In api/payments/prepare-skill-purchase.js (GET handler)
// ... after granting skill access

import { sendPurchaseConfirmationEmail } from '../../services/notifications';

// ...
await grantSkillToUser(...);
await logTransaction(...);

// Asynchronously send the notification so it doesn't block the response
sendPurchaseConfirmationEmail(purchaseDetails.userId, {
    skillName: purchaseDetails.skillName,
    agentName: purchaseDetails.agentName,
    amount: purchaseDetails.amount,
});

res.status(200).json({ status: 'ok', message: 'Purchase confirmed!' });
```
