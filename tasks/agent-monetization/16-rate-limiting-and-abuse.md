# Task 16 — Rate Limiting & Abuse Prevention for Paid Skills

## Goal
Prevent abuse of the payment and pricing APIs: rate-limit payment intent creation, prevent fake intent replays, and ensure callers can't enumerate skill prices to scrape agent configurations at scale.

## Success Criteria
- Payment intent creation is rate-limited per caller address
- Replayed payment proofs are rejected (idempotency enforcement)
- Pricing endpoint has a reasonable public rate limit
- Withdrawal endpoint is rate-limited per user

## Changes

### 1. Payment Intent Rate Limit
In the x402 intent creation handler, add a per-payer rate limit using the existing Upstash Redis rate limiter.

Add a new rate limit bucket to `/api/_lib/rate-limit.js`:
```js
export const paymentIntentPerPayer = rateLimit({
  prefix: 'payment_intent_payer',
  limit: 20,
  window: 60,   // 20 intents per minute per payer address
});
```

Apply in the intent creation endpoint:
```js
const limited = await paymentIntentPerPayer.check(payerAddress);
if (limited) return error(res, 429, 'rate_limited', 'Too many payment attempts');
```

### 2. Intent Replay Prevention
Payment intents already have a unique `id` and status machine. Ensure the skill access handler checks:
```sql
SELECT status FROM agent_payment_intents
WHERE id = $1 AND status = 'paid'
FOR UPDATE
```
If `status != 'paid'` → reject with 409. The existing `status = 'consumed'` update inside a transaction handles this, but verify it's in a transaction (`BEGIN/COMMIT`).

### 3. Pricing Endpoint Public Rate Limit
Add to the GET `/api/agents/:id/pricing` handler:
```js
export const pricingPerIp = rateLimit({
  prefix: 'pricing_ip',
  limit: 100,
  window: 60,  // 100 reads/minute per IP
});
```

### 4. Withdrawal Rate Limit
In `POST /api/billing/withdrawals`, add:
```js
export const withdrawalPerUser = rateLimit({
  prefix: 'withdrawal_user',
  limit: 3,
  window: 3600,  // 3 withdrawal requests per hour per user
});
```

### 5. Minimum Withdrawal Amount
In the withdrawal API (Task 07), enforce a minimum amount (e.g., 1 USDC = 1,000,000 lamports):
```js
const MIN_WITHDRAWAL = 1_000_000;
if (amount < MIN_WITHDRAWAL) {
  return error(res, 422, 'below_minimum', 'Minimum withdrawal is 1 USDC');
}
```

## Files to Touch
- `/api/_lib/rate-limit.js` — add 3 new rate limit configs
- The x402 intent creation handler — add payer rate limit
- `/api/agents/:id/pricing` GET handler — add IP rate limit
- `/api/billing/withdrawals/index.js` — add user rate limit and minimum

## Verify
```bash
# Hammer intent creation from same address — should 429 after 20 req/min
for i in {1..25}; do curl -X POST /api/agents/:id/x402/:skill/prep ...; done

# Replay intent ID — should 409
curl POST .../x402/:skill/consume with same intent_id twice

# Withdrawal below minimum
curl POST /api/billing/withdrawals -d '{"amount":100,...}'
# → 422 below_minimum
```
