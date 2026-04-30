# Task 02 — API: Skill Pricing CRUD

## Goal
REST endpoints so agent owners can read, set, and remove per-skill prices for their agents.

## Success Criteria
- Owner can GET, PUT, and DELETE skill prices
- Non-owner gets 403
- Unauthenticated gets 401
- PUT validates amount > 0, known chain, non-empty skill name
- Changes are immediately reflected in x402 manifest (Task 03 depends on this)

## Endpoints

### `GET /api/agents/:id/pricing`
Returns all active skill prices for the agent.

```json
{
  "prices": [
    {
      "id": "uuid",
      "skill": "answer-question",
      "currency_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "chain": "solana",
      "amount": 1000000,
      "is_active": true
    }
  ]
}
```

Auth: session or Bearer token. Public agents: prices are readable by anyone. Private agents: owner only.

### `PUT /api/agents/:id/pricing/:skill`
Create or update the price for a specific skill.

Request body:
```json
{
  "currency_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "chain": "solana",
  "amount": 1000000,
  "is_active": true
}
```

Requires: authenticated, `user_id` must match agent owner.

Validation:
- `amount` must be integer > 0
- `chain` must be one of: `solana`, `base`, `evm`
- `currency_mint` must be non-empty string
- `skill` must be a valid identifier (alphanumeric + hyphens, max 64 chars)

Uses `INSERT ... ON CONFLICT (agent_id, skill) DO UPDATE`.

Response: `201` on create, `200` on update.

### `DELETE /api/agents/:id/pricing/:skill`
Soft-delete (sets `is_active = false`). Hard-delete on explicit `?hard=true` for owners who want to fully remove.

## File to Create
`/api/agents/[id]/pricing/index.js` — handles GET
`/api/agents/[id]/pricing/[skill].js` — handles PUT, DELETE

## Shared Helpers to Use
- `requireAuth(req)` from `/api/_lib/auth.js`
- `db` from `/api/_lib/db.js`
- `json(res, status, body)` and `error(res, status, code, msg)` from `/api/_lib/http.js`
- `validate(schema, data)` from `/api/_lib/validate.js`

## Verify
```bash
# Set price
curl -X PUT /api/agents/:id/pricing/answer-question \
  -H "Cookie: __Host-sid=..." \
  -d '{"currency_mint":"EPjF...","chain":"solana","amount":1000000}'

# Read back
curl /api/agents/:id/pricing

# Non-owner should 403
curl -X PUT /api/agents/:id/pricing/answer-question \
  -H "Cookie: __Host-sid=<other-user-session>" ...
```
