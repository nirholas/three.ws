---
status: not-started
---

# Prompt 17: Backend - Transactional Emails

## Objective
Implement automated transactional emails for key monetization events to keep users informed and engaged.

## Explanation
Transactional emails are a crucial part of a professional product. They confirm actions, build trust, and can bring users back to the platform. Events like a successful purchase, a new referral, or a monthly earnings summary all warrant a clear and timely email notification.

## Instructions
1.  **Choose and Integrate an Email Service Provider (ESP):**
    *   Select an ESP like SendGrid, Postmark, or AWS SES.
    *   Sign up and get your API keys.
    *   Install their Node.js SDK (e.g., `npm install @sendgrid/mail`).
    *   Create a helper module (e.g., `/api/_lib/email.js`) to centralize your email-sending logic.

2.  **Create Email Templates:**
    *   Design simple, clean HTML templates for each email type. You can create these in your ESP's dashboard or as local files.
    *   Required templates:
        *   **Skill Purchase Receipt:** Sent to the buyer. Details the skill purchased, price, and a link back to the agent.
        *   **New Sale Notification:** Sent to the creator. Informs them they've made a sale.
        *   **New Referral Signup:** Sent to the referrer. Lets them know someone signed up with their code.
        *   **Referral Commission Earned:** Sent to the referrer. Informs them they've earned a commission from a sale.
        *   **API Subscription Confirmation:** Sent to a new API subscriber.

3.  **Trigger Emails from Backend Logic:**
    *   **Purchase Receipt:** In your payment verification logic, after successfully recording a purchase, call your email helper to send the receipt to the buyer.
    *   **Sale Notification:** At the same time, trigger the notification to the skill's creator.
    *   **Referral Emails:** In the registration and commission logic, call the email helper to notify the referrer.
    *   **Subscription Email:** In your Stripe webhook handler for `checkout.session.completed`, trigger the subscription confirmation email.

## Email Helper Example (`/api/_lib/email.js`)

```javascript
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendEmail({ to, subject, html, text }) {
  const msg = {
    to,
    from: 'noreply@3d-agent.com', // Use a verified sender
    subject,
    text,
    html,
  };

  try {
    await sgMail.send(msg);
  } catch (error) {
    console.error('Email sending failed:', error);
    // Add more robust error handling/logging
  }
}

export async function sendPurchaseReceiptEmail({ buyerEmail, skillName, price }) {
  const subject = 'Your 3D-Agent Skill Purchase';
  const html = `<p>Thank you for purchasing the skill: <strong>${skillName}</strong> for ${price}.</p>`;
  await sendEmail({ to: buyerEmail, subject, html });
}

// ... other email functions
```
