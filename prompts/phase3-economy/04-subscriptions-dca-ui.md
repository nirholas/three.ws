---
mode: agent
description: 'Phase 3 — Subscriptions & DCA UI: users subscribe to an agent creator, recurring onchain payments via cron'
---

# Phase 3 · Subscriptions & DCA UI

**Branch:** `feat/subscriptions-dca-ui`
**Standalone.** No other prompt must ship first.

## Why it matters

The cron infrastructure is in place (`api/cron/[name].js`). What's missing is the user-facing subscription management: a creator sets a price, a fan subscribes, and the platform processes recurring payments. This is the first real creator monetization flow that doesn't require a token launch.

## Read these first

| File | Why |
|:---|:---|
| `api/cron/[name].js` | Existing cron dispatcher — add `process-subscriptions` here. |
| `vercel.json` | Cron schedule format (see existing `"crons"` array). |
| `api/_lib/schema.sql` | Table definitions. |
| `api/_lib/db.js` | Neon postgres `sql` tagged template. |
| `api/agents/[id].js` | Agent detail — includes creator user_id. |
| `api/_lib/rate-limit.js` | Rate limit pattern to reuse. |
| `api/wk-x402.js` | x402 payment handler — re-read before wiring payments. |

## What to build

### 1. Database schema

Add to `api/_lib/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS subscription_plans (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id     uuid        REFERENCES agent_identities(id) ON DELETE SET NULL,
  name         text        NOT NULL,
  price_usd    numeric(8,2) NOT NULL CHECK (price_usd >= 0.99),
  interval     text        NOT NULL DEFAULT 'monthly' CHECK (interval IN ('weekly','monthly')),
  perks        text[],
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id             uuid        NOT NULL REFERENCES subscription_plans(id),
  subscriber_user_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status              text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled','past_due')),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end   timestamptz NOT NULL,
  payment_method      text        NOT NULL DEFAULT 'x402',   -- 'x402' for now
  wallet_address      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  cancelled_at        timestamptz,
  UNIQUE(plan_id, subscriber_user_id)
);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid        NOT NULL REFERENCES subscriptions(id),
  amount_usd      numeric(8,2) NOT NULL,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
  tx_hash         text,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 2. Creator plan management API

File: `api/subscriptions/plans.js`

```
GET    /api/subscriptions/plans?creator_id=  — list plans for a creator (public)
POST   /api/subscriptions/plans              — create a plan (auth, max 3 per user)
PATCH  /api/subscriptions/plans/:id          — update name/price/perks (auth, owner)
DELETE /api/subscriptions/plans/:id          — soft-delete (auth, owner)
```

Input schema (zod):
```js
{
  agent_id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  price_usd: z.number().min(0.99).max(999),
  interval: z.enum(['weekly','monthly']).default('monthly'),
  perks: z.array(z.string().trim().max(120)).max(10).default([]),
}
```

### 3. Subscriber API

File: `api/subscriptions/index.js`

```
POST   /api/subscriptions           — subscribe to a plan (auth required)
GET    /api/subscriptions/mine      — list my active subscriptions (auth)
DELETE /api/subscriptions/:id       — cancel (auth, subscriber)
GET    /api/subscriptions/:id       — detail (auth, subscriber or creator)
```

Subscribe flow:
1. Auth required, wallet_address in body.
2. Create `subscriptions` row with `current_period_end = now() + interval`.
3. Immediately attempt first payment (call `chargeSubscription(subscription_id)` — see §4).
4. Return subscription detail.

### 4. Payment processing — `api/_lib/subscription-billing.js`

```js
export async function chargeSubscription(subscriptionId) {
  // 1. Load subscription + plan + subscriber wallet.
  // 2. If payment_method = 'x402': use x402 to charge plan.price_usd from subscriber wallet_address.
  //    The x402 flow: create a payment intent (see api/wk-x402.js for the protocol),
  //    record in subscription_payments, update current_period_end on success.
  // 3. On failure: mark subscription 'past_due', record failed payment.
  // 4. Return { success, tx_hash, error? }.
}
```

For x402 payment: follow the pattern in `api/wk-x402.js`. The charge is a server-initiated pull from the subscriber's pre-authorized wallet. If x402 doesn't support server-initiated pulls yet, use the DB `wallet_address` field to construct a payment request and mark as `pending` — do NOT block. Log clearly that this requires the subscriber to approve. This is the real implementation — not a stub.

### 5. Cron: `process-subscriptions`

In `api/cron/[name].js`, add:
```js
case 'process-subscriptions':
  return handleProcessSubscriptions(req, res);
```

`handleProcessSubscriptions`:
1. Find all `active` subscriptions where `current_period_end < now() + 1 hour` (charging a bit early to handle retry window).
2. For each: call `chargeSubscription(id)`.
3. Retry failed subscriptions up to 3 times (tracked via `subscription_payments` count).
4. After 3 failures: set status `past_due`, email the subscriber via Resend (use `RESEND_API_KEY` from env, already in `api/_lib/env.js`).
5. Log results.

Add to `vercel.json` crons:
```json
{ "path": "/api/cron/process-subscriptions", "schedule": "0 */6 * * *" }
```

### 6. Creator earnings page

Add to `public/dashboard/index.html` a "Subscriptions" tab showing:
- List of my plans (if I'm a creator): plan name, price, subscriber count, total earned
- List of my subscriptions (if I'm a subscriber): plan name, creator, next billing date, status, Cancel button

Fetch data from:
- `GET /api/subscriptions/plans?creator_id={myId}` for creator view
- `GET /api/subscriptions/mine` for subscriber view

Vanilla HTML/JS. Match existing dashboard tab style.

### 7. Subscribe button on agent page

In the agent detail page (`src/agent-home.js`), if the agent's creator has active plans, show a "Subscribe" button below the agent name. Clicking opens a modal listing available plans with price + perks + "Subscribe" CTA. On click, call `POST /api/subscriptions`.

## Routes

Add to `vercel.json`:
```json
{ "src": "/api/subscriptions/plans(/.*)?", "dest": "/api/subscriptions/plans.js" },
{ "src": "/api/subscriptions(/.*)?", "dest": "/api/subscriptions/index.js" },
{ "src": "/api/cron/process-subscriptions", "dest": "/api/cron/[name].js" }
```

## Out of scope

- Stripe integration.
- Refunds.
- Tiered plan upgrades/downgrades.
- Trial periods.

## Acceptance

- [ ] Creator can POST a plan, see it in GET, update it, delete it.
- [ ] User can subscribe to a plan; subscription row is created.
- [ ] `chargeSubscription` creates a `subscription_payments` row (pending or succeeded).
- [ ] `process-subscriptions` cron is listed in `vercel.json`.
- [ ] Dashboard Subscriptions tab shows plans (creator view) and subscriptions (subscriber view).
- [ ] Subscribe button appears on agent page when plans exist.
- [ ] `node --check` passes on all new files.
- [ ] `npx vite build` passes.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
