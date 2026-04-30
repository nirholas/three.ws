# Task 03 — Update x402 Manifest to Use Dynamic Pricing

## Goal
The existing endpoint `GET /api/agents/:id/x402/:skill/manifest` returns a hardcoded payment manifest. Update it to pull live pricing from the `agent_skill_prices` table created in Task 01.

## Current Behavior (file: `/api/agents/x402/[...slug].js` or similar)
The manifest likely returns a static amount from env vars or agent meta. Find the exact file and understand its shape before editing.

## Success Criteria
- Manifest amount matches the price set via the pricing API (Task 02)
- If no price is configured for the skill, return `404` with `{ error: "skill_not_priced" }`
- If `is_active = false`, return `404` with `{ error: "skill_not_available" }`
- Existing x402 intent creation flow continues to work unchanged

## Changes Required

### In the manifest handler:
1. Parse `agent_id` and `skill` from the route
2. Query `agent_skill_prices` for a row where `agent_id = ? AND skill = ? AND is_active = true`
3. If no row → 404
4. Build the manifest using `row.amount`, `row.currency_mint`, `row.chain`
5. Keep payout address from `agent_payout_wallets` (join on `agent_id`, fallback to agent's `wallet_address` in `agent_identities`)

### Payout address resolution (new helper `resolvePayoutAddress(agentId, chain)`)
```js
// api/_lib/payout.js
export async function resolvePayoutAddress(agentId, chain) {
  const row = await db.query(
    `SELECT address FROM agent_payout_wallets
     WHERE agent_id = $1 AND chain = $2
     ORDER BY is_default DESC, created_at DESC LIMIT 1`,
    [agentId, chain]
  );
  if (row) return row.address;
  // Fallback: agent's own wallet_address
  const agent = await db.query(
    `SELECT wallet_address FROM agent_identities WHERE id = $1`,
    [agentId]
  );
  return agent?.wallet_address ?? null;
}
```

## Files to Touch
- Find and edit the existing x402 manifest endpoint (search for `x402` in `/api/agents/`)
- Add `/api/_lib/payout.js` (new helper)

## Do NOT Change
- Intent creation (`agent_payment_intents` insert) — that's unchanged
- Payment verification logic
- x402 spec envelope structure

## Verify
```bash
# After setting price via Task 02 API:
curl /api/agents/:id/x402/answer-question/manifest
# Should return manifest with amount=1000000 and correct payTo address

# Unpriced skill:
curl /api/agents/:id/x402/unpriced-skill/manifest
# Should return 404 { error: "skill_not_priced" }
```
