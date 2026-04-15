# 01-02 — Display ENS / basename for linked wallets

## Why it matters

Users see `0xabc…1234` today. That's hostile. Showing `nich.eth` or `nich.base.eth` when available is the cheapest possible UX upgrade for the wallet-auth layer and a prerequisite for trusting the identity we later publish on-chain (Layer 6). Without it, wallets feel like plumbing instead of identity.

## Context

- SIWE verify path: [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js).
- Linked-wallet table: `user_wallets` in [api/_lib/schema.sql](../../api/_lib/schema.sql).
- Session helper: `getSessionUser` in [api/_lib/auth.js](../../api/_lib/auth.js).
- Dashboard render: [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js).

## What to build

### Endpoint — `api/auth/wallets/resolve-name.js`

- `GET ?address=0x…&chain_id=1|8453`. Public (no session required — names are public).
- Resolves via public RPC, with a 24h cache keyed on `(address, chain_id)`.
  - `chain_id=1` → ENS (`name.eth`) via reverse record.
  - `chain_id=8453` → basename via the Base name registrar. Fall back to ENS mainnet if no basename.
- Response: `{ address, name: "nich.eth" | null, avatar: "https://…" | null, chain_id, ttl }`.
- Cache: use the existing rate-limit/kv pattern in [api/_lib/rate-limit.js](../../api/_lib/rate-limit.js) (Neon `kv` table or equivalent — reuse, don't invent).
- Failures (RPC down, no record) → `{ name: null }` with 200, not 5xx.

### Persist on link

When `api/auth/siwe/link.js` (from 01-01) inserts a row, fire-and-forget a call to `resolve-name` and write the result to a new nullable column:

```sql
alter table user_wallets add column if not exists ens_name text;
alter table user_wallets add column if not exists ens_avatar_url text;
alter table user_wallets add column if not exists ens_resolved_at timestamptz;
```

Re-resolve opportunistically when `ens_resolved_at` is older than 24h on next read.

### Dashboard render

In [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js), replace any `0xabc…1234` render of a linked wallet with `name || shortAddress(address)`. If `ens_avatar_url` is set, show it as a 24px circle next to the name.

## Out of scope

- Writing ENS records. Read-only.
- Multi-chain beyond mainnet + Base.
- Avatar-image proxying through our CDN (use the URL returned by the resolver directly; if CSP blocks it, file a follow-up).
- Any UI for users to "refresh" the name — the 24h auto-refresh is enough.

## Acceptance

1. Link a wallet that has an ENS reverse record → dashboard shows the name within the next page load.
2. Link a wallet with no ENS record → short address still renders; no console errors.
3. `GET /api/auth/wallets/resolve-name?address=vitalik.eth-address` returns `{ name: "vitalik.eth" }`.
4. Second call within 24h is served from cache (check RPC hit count or log).
5. `node --check` passes on new files.
