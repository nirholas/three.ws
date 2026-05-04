---
status: not-started
---

# Prompt 10: Backend Payout Cron Job

**Status:** Not Started

## Objective
Create a scheduled job (cron job) that calculates creator earnings and initiates payouts.

## Explanation
This is a backend-only task. On a regular schedule (e.g., weekly or monthly), a script needs to run that:
1.  Calculates the total revenue for each agent creator from `skill_purchases`.
2.  Subtracts any platform fees.
3.  Initiates a transfer to the creator's wallet stored in `creator_payout_settings`.
4.  Records the transaction in the `payouts` table.

## Instructions
- [ ] **Create a new cron job file** within the Vercel infrastructure (e.g., `/api/cron/process-payouts.js`).
- [ ] **Configuration:**
    - [ ] Configure `vercel.json` to schedule this job to run periodically (e.g., once a month).
- [ ] **Script Logic:**
    - [ ] Find the date of the last payout for each user to determine the new earnings period.
    - [ ] `SELECT` and `SUM` the `purchase_amount` from `skill_purchases`, grouped by the agent's `user_id`.
    - [ ] For each user with earnings, calculate the final payout amount after fees.
    - [ ] Fetch their payout wallet from `creator_payout_settings`.
    - [ ] Use the Solana SDK to create and send a transaction for the payout amount.
    - [ ] After the transaction is confirmed, `INSERT` a record into the `payouts` table.
- [ ] **Security:** This endpoint must be protected and only executable by Vercel's cron service, typically via a secret key.

## Code Example (Conceptual Vercel Cron Job)

```javascript
// In /api/cron/process-payouts.js
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
    // 1. Authenticate the cron job request
    // ...

    // 2. Determine earnings period (e.g., the last month)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 1);

    // 3. Calculate earnings for all creators in this period
    const { rows: earnings } = await sql`
        SELECT i.user_id, SUM(p.purchase_amount) as total_earnings
        FROM skill_purchases p
        JOIN agent_identities i ON p.agent_id = i.id
        WHERE p.created_at >= ${startDate} AND p.created_at < ${endDate}
        GROUP BY i.user_id;
    `;

    // 4. Process each payout
    for (const userEarning of earnings) {
        const platformFee = 0.10; // 10% fee
        const payoutAmount = userEarning.total_earnings * (1 - platformFee);

        // Fetch wallet, create & send Solana tx, then record in payouts table
        // ... (complex logic here) ...
    }

    res.status(200).send('Payouts processed');
}
```
