# Fix: `TypeError: limits.pricingPerIp is not a function` in pricing endpoint

## What is broken

`GET /api/agents/:id/pricing` crashes with:

```
TypeError: limits.pricingPerIp is not a function
```

This route is hit by x402 manifest readers to check per-skill prices. Every call
returns a 500 because `pricingPerIp` is called but never defined.

## Root cause

File: `api/agents/_id/pricing/index.js` (or `api/agents/[id]/pricing/index.js`), line ~11:

```js
const rl = await limits.pricingPerIp(clientIp(req));
```

File: `api/_lib/rate-limit.js` — the `limits` export object has no `pricingPerIp`
property. Every other named preset is present (e.g. `publicIp`, `mcpIp`, `authIp`),
but `pricingPerIp` was never added.

## Fix

### Option A (preferred) — add `pricingPerIp` to `rate-limit.js`

Open `api/_lib/rate-limit.js`. In the `limits` export object, add a new preset
alongside the other public read limiters (near `publicIp`):

```js
pricingPerIp: (ip) => getLimiter('pricing:ip', { limit: 120, window: '1 m' }).limit(ip),
```

120 req/min per IP matches `agentByAddress` and other low-sensitivity public reads.
Place it near the `publicIp` entry for logical grouping.

No other files need to change — `pricing/index.js` already imports and calls it
correctly, it just doesn't exist yet.

### Option B (simpler) — swap the call to the existing `publicIp` preset

If you prefer not to add a new limiter, in `api/agents/_id/pricing/index.js` change:

```js
// Before
const rl = await limits.pricingPerIp(clientIp(req));

// After
const rl = await limits.publicIp(clientIp(req));
```

`publicIp` is defined as 60 req/min per IP — slightly stricter than 120, but safe
for a pricing endpoint.

Pick whichever option you prefer. Option A is preferred because it gives the pricing
endpoint its own named bucket that can be tuned independently.

## Verify

1. `GET /api/agents/x402/pricing` (use any real agent id) should return 200 with a
   `{ prices: [...] }` array — even if the array is empty.
2. Confirm no more `TypeError: limits.pricingPerIp is not a function` in logs.
3. If you chose Option A: `grep "pricingPerIp" api/_lib/rate-limit.js` must return
   one line (the definition).
4. If you chose Option B: `grep "pricingPerIp" api/agents/_id/pricing/index.js` must
   return nothing.

## Constraints

- Do not change the response shape: `{ prices: [...] }` where each price has
  `id, skill, currency_mint, chain, amount, is_active`.
- Do not add auth to this endpoint — it is intentionally public (x402 agents read it
  without credentials).
- Do not change the SQL query or the `agent_skill_prices` table.
- No mocking. The fix must result in the real Postgres query running.
