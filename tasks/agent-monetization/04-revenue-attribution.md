# Task 04 — Revenue Attribution: Write Revenue Events on Intent Consumption

## Goal
When a caller pays for a skill and the intent is consumed, write an immutable `agent_revenue_events` row. This is the financial record that powers the revenue dashboard and withdrawal system.

## Success Criteria
- Every consumed intent creates exactly one `agent_revenue_events` row
- Platform fee (configurable, default 2.5%) is calculated and stored
- `net_amount = gross_amount - fee_amount` is always correct
- Double-consumption is prevented (the existing intent status check still holds)

## Where to Hook In

Find where intents transition from `paid` → `consumed`. This is likely in:
- `/api/agents/x402/[...slug].js` (the skill access verification endpoint)
- Or wherever `UPDATE agent_payment_intents SET status = 'consumed'` happens

After the intent is marked consumed (inside the same transaction if possible), insert into `agent_revenue_events`.

## Platform Fee

Add env var: `PLATFORM_FEE_BPS` (basis points, default `250` = 2.5%).

```js
// api/_lib/fee.js
const FEE_BPS = parseInt(process.env.PLATFORM_FEE_BPS ?? '250', 10);

export function calculateFee(grossAmount) {
  const fee = Math.floor((grossAmount * FEE_BPS) / 10_000);
  return { fee, net: grossAmount - fee };
}
```

## Revenue Event Insert

```js
import { calculateFee } from '../_lib/fee.js';

// Inside intent consumption handler, after status update:
const { fee, net } = calculateFee(intent.amount);
await db.query(
  `INSERT INTO agent_revenue_events
     (agent_id, intent_id, skill, gross_amount, fee_amount, net_amount,
      currency_mint, chain, payer_address)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [intent.agent_id, intent.id, intent.skill, intent.amount,
   fee, net, intent.currency_mint, intent.chain, payerAddress]
);
```

`payerAddress` should come from the payment proof in the x402 request headers (the `X-Payment` header contains the signed payment with sender address).

## Files to Touch
- Find and edit the intent consumption endpoint in `/api/agents/`
- Add `/api/_lib/fee.js` (new helper)

## Do NOT Change
- Intent status machine logic
- x402 header parsing
- Skill response format

## Verify
```bash
# Complete a full payment flow for a priced skill.
# Then query:
psql $DATABASE_URL -c "SELECT * FROM agent_revenue_events ORDER BY created_at DESC LIMIT 5;"
# Verify fee_amount = floor(gross_amount * 0.025)
# Verify net_amount = gross_amount - fee_amount
```
