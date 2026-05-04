---
status: not-started
---

# Prompt 23: Email Receipts and Notifications

## Objective
Integrate an email service to send users receipts for their purchases and notifications for subscription events.

## Explanation
Professional platforms communicate with users via email for important events. Sending a receipt after a purchase confirms the transaction and provides a record for the user. Email notifications are also crucial for managing subscriptions.

## Instructions
- [ ] **Choose and Integrate an Email Service Provider:**
    - [ ] Sign up for a transactional email service like SendGrid, Postmark, or Resend.
    - [ ] Obtain an API key and configure it securely on your backend (using environment variables).
    - [ ] Install the provider's SDK in your backend service.

- [ ] **Send One-Time Purchase Receipts:**
    - [ ] In your backend's transaction verification endpoint (`/api/skills/purchase/verify`), after successfully recording the skill ownership:
    - [ ] Call a new function, e.g., `sendPurchaseReceiptEmail`.
    - [ ] This function should use the email service's SDK to send an email to the user.
    - [ ] The email should be based on a template and include details like the user's name, skill name, agent name, price paid, and transaction signature.

- [ ] **Send Subscription-Related Emails:**
    - [ ] In your payments webhook (`/api/webhooks/payments`), trigger emails for key events:
        - [ ] **`subscription.created`**: Send a "Welcome" email confirming the subscription start.
        - [ ] **`subscription.payment_succeeded`**: Send a monthly/yearly receipt for the renewal payment.
        - [ ] **`subscription.payment_failed`**: Send a notification that the payment failed and they need to update their payment information.
        - [ ] **Upcoming Renewal Reminder**: Set up a scheduled job (e.g., a cron job) that runs daily to find subscriptions expiring in a few days and send a reminder email.

## Code Example (Sending a receipt with Resend)

```javascript
// utils/email.js
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendPurchaseReceiptEmail(user, purchaseDetails) {
    try {
        await resend.emails.send({
            from: 'Your App <noreply@yourapp.com>',
            to: user.email,
            subject: 'Your Skill Purchase Receipt',
            html: `
                <h1>Receipt</h1>
                <p>Hi ${user.name},</p>
                <p>Thank you for purchasing the skill: <strong>${purchaseDetails.skillName}</strong>.</p>
                <p>Price: ${purchaseDetails.price} USDC</p>
                <p>Transaction: ${purchaseDetails.signature}</p>
            `,
        });
    } catch (error) {
        console.error('Failed to send email:', error);
    }
}


// In the /api/skills/purchase/verify endpoint after success
import { sendPurchaseReceiptEmail } from 'utils/email';

// ...
if (isVerified) {
    await recordSkillOwnership(...);
    await sendPurchaseReceiptEmail(req.user, { ... }); // Fire-and-forget
    res.status(200).json({ message: "Verification successful." });
}
// ...
```
