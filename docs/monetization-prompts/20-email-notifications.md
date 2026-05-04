# Prompt 20: Email Notifications for Monetization Events

## Objective
Implement email notifications for creators and users for key monetization events like "Skill Sold" and "Payout Processed".

## Explanation
Communication is key to a good user experience. Automated emails build trust and keep users informed. We should notify creators when they make a sale and when their withdrawal has been successfully processed.

## Instructions
1.  **Choose an Email Service Provider:**
    *   Select and configure an email sending service like Resend, SendGrid, or Postmark.
    *   Add the necessary API keys and sender email addresses to your environment variables.

2.  **Create Email Sending Utilities:**
    *   In `api/_lib/`, create a new file, e.g., `email.js`.
    *   This file should contain helper functions to send transactional emails using your chosen provider's SDK.
    *   Create templates for each notification type.

3.  **Integrate "Skill Sold" Notification:**
    *   In the purchase confirmation webhook (`api/webhooks/solana-pay.js`), after successfully updating the purchase status to `'confirmed'`:
    *   Call your email helper to send a "You've made a sale!" email to the skill creator.
    *   Include details like the skill name, agent name, and amount earned.

4.  **Integrate "Payout Processed" Notification:**
    *   In the payout processing worker (`workers/payout-processor.js`), after a payout transaction is successfully confirmed:
    *   Call your email helper to send a "Your payout is on its way" email to the creator.
    *   Include the amount, destination wallet, and a link to the transaction on a block explorer.

## Code Example (Conceptual - in `solana-pay.js` webhook)

```javascript
import { sendSaleNotification } from '../_lib/email.js';

// ... after validating transaction and updating DB ...

if (isValid) {
  await sql`
    UPDATE user_skill_purchases SET status = 'confirmed' ...
  `;
  
  // Fetch creator's email and send notification
  const [creator] = await sql`SELECT email FROM users WHERE id = ${purchase.creator_id}`;
  if (creator.email) {
    await sendSaleNotification(creator.email, {
      skillName: purchase.skill_id,
      amount: purchase.amount,
    });
  }

  return json(res, { message: 'Transaction confirmed' });
}
```
