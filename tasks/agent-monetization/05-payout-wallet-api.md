# Task 05 — API: Payout Wallet Configuration

## Goal
Endpoints for agent owners to register the wallet address that receives their revenue. Supports per-agent and per-user-default wallets, multiple chains.

## Success Criteria
- Owner can add, list, and remove payout wallets
- Can mark one wallet as default per chain
- Wallet address format is validated per chain type
- `resolvePayoutAddress()` from Task 03 returns correct address

## Endpoints

### `GET /api/billing/payout-wallets`
Returns all payout wallets for the authenticated user.

```json
{
  "wallets": [
    {
      "id": "uuid",
      "agent_id": null,
      "address": "7xK...",
      "chain": "solana",
      "is_default": true
    }
  ]
}
```

### `POST /api/billing/payout-wallets`
Register a new payout wallet.

```json
{
  "address": "7xK...",
  "chain": "solana",
  "agent_id": null,
  "is_default": true
}
```

If `is_default: true`, set all other wallets for the same `(user_id, chain)` to `is_default = false` first (in a transaction).

Validation:
- Solana: base58, 32–44 chars
- EVM/Base: starts with `0x`, 42 chars, valid checksum preferred

### `DELETE /api/billing/payout-wallets/:id`
Remove a payout wallet. If it was default, clear the default (caller must set a new one).

## Files to Create
- `/api/billing/payout-wallets/index.js` — GET, POST
- `/api/billing/payout-wallets/[id].js` — DELETE

## Address Validation Helper

Add to `/api/_lib/validate.js`:

```js
export function isValidSolanaAddress(addr) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

export function isValidEvmAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}
```

## Verify
```bash
# Add a Solana payout wallet
curl -X POST /api/billing/payout-wallets \
  -H "Cookie: __Host-sid=..." \
  -d '{"address":"7xK...","chain":"solana","is_default":true}'

# List wallets
curl /api/billing/payout-wallets -H "Cookie: __Host-sid=..."

# Invalid address should 400
curl -X POST /api/billing/payout-wallets \
  -d '{"address":"not-valid","chain":"solana"}'
```
