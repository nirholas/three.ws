# Task 07 — API: Withdrawal (Payout) Flow

## Goal
Allow agent owners to request a payout of their earned revenue. The flow is: owner requests withdrawal → backend validates sufficient balance → creates `agent_withdrawals` row in `pending` state → (cron or webhook) processes the on-chain transfer → marks `completed`.

## Success Criteria
- Owner can request a withdrawal for a specific amount and currency
- System validates available (unconsumed) net balance before creating the request
- Double-withdrawal is prevented (pending + processing withdrawals reduce available balance)
- Status transitions: `pending` → `processing` → `completed` | `failed`
- Only the owner can initiate; only an admin or cron can advance status to `processing`/`completed`

## Endpoints

### `POST /api/billing/withdrawals`
Initiate a withdrawal request.

```json
{
  "amount": 10000000,
  "currency_mint": "EPjF...",
  "chain": "solana",
  "to_address": "7xK...",
  "agent_id": "uuid-or-null"
}
```

**Available balance check:**
```sql
SELECT
  COALESCE(SUM(net_amount), 0) AS earned,
  (
    SELECT COALESCE(SUM(amount), 0)
    FROM agent_withdrawals w2
    WHERE w2.user_id = $1
      AND w2.status IN ('pending','processing')
      AND w2.currency_mint = $2
  ) AS pending_amount
FROM agent_revenue_events re
JOIN agent_identities ai ON ai.id = re.agent_id
WHERE ai.user_id = $1
  AND re.currency_mint = $2
```

`available = earned - pending_amount`. If `requested_amount > available` → 422 `{ error: "insufficient_balance" }`.

On success: insert into `agent_withdrawals` with `status = 'pending'`, return `{ id, status, amount, ... }`.

### `GET /api/billing/withdrawals`
List the authenticated user's withdrawal history.

Query params: `status` (optional filter), `limit` (default 20), `offset` (default 0).

### `GET /api/billing/withdrawals/:id`
Single withdrawal details.

## Admin Endpoint (separate from user-facing)

### `PATCH /api/admin/withdrawals/:id`
Advance withdrawal status. Admin-only.

```json
{ "status": "processing", "tx_signature": "5J..." }
```

Only transitions:
- `pending` → `processing` (set `tx_signature`)
- `processing` → `completed` | `failed`

## Files to Create
- `/api/billing/withdrawals/index.js` — GET (list), POST
- `/api/billing/withdrawals/[id].js` — GET single
- `/api/admin/withdrawals/[id].js` — PATCH (admin only, use existing `requireAdmin()`)

## Verify
```bash
# Initiate withdrawal
curl -X POST /api/billing/withdrawals \
  -H "Cookie: __Host-sid=..." \
  -d '{"amount":1000000,"currency_mint":"EPjF...","chain":"solana","to_address":"7xK..."}'

# Over-withdrawal should 422
curl -X POST /api/billing/withdrawals \
  -d '{"amount":9999999999,...}'
# → { error: "insufficient_balance" }

# List
curl /api/billing/withdrawals -H "Cookie: __Host-sid=..."
```
