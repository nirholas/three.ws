# 01-03 — Primary wallet selection

## Why it matters

`user_wallets` supports many wallets per user, but the `users.wallet_address` column only holds one. Today it mirrors whichever wallet was linked first. The user has no way to change it. This matters because Layer 6 (onchain portability) uses the primary wallet as the controller address that signs ERC-8004 registrations — picking the wrong one silently ties the on-chain identity to a throwaway wallet.

## Context

- Schema: `users.wallet_address`, `user_wallets(user_id, address, chain_id, created_at)` in [api/_lib/schema.sql](../../api/_lib/schema.sql).
- Linking endpoints: `api/auth/siwe/link.js` (from 01-01).
- Session helper: `getSessionUser` in [api/_lib/auth.js](../../api/_lib/auth.js).
- Dashboard wallet section: [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js).

## What to build

### Schema

```sql
alter table user_wallets add column if not exists is_primary boolean not null default false;
create unique index if not exists user_wallets_primary_per_user
    on user_wallets(user_id) where is_primary;
```

One-time backfill (include in the same migration): for each user with ≥1 wallet and no primary, set the oldest `user_wallets` row to `is_primary = true` and mirror to `users.wallet_address`.

### Endpoint — `POST /api/auth/wallets/primary`

- Session-authed. Body: `{ address }`.
- In a single transaction:
  1. Verify the address belongs to the caller in `user_wallets` → else 404.
  2. `update user_wallets set is_primary = (address = $1) where user_id = $me`.
  3. `update users set wallet_address = $1 where id = $me`.
- Returns `{ ok: true, primary: address }`.

### Dashboard UI

In [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js), beside each linked wallet show:

- A radio button "Primary" — checked if `is_primary`.
- Clicking a non-primary radio calls the endpoint, then re-renders the list.
- Primary wallet gets a subtle gold border or label; disconnecting the primary is blocked with a tooltip ("Set another wallet as primary first") unless it's the last wallet.

### `GET /api/auth/me` response

Add `wallets: [{ address, chain_id, is_primary, ens_name }]` to the session payload so the dashboard can render without a second request.

## Out of scope

- Per-action wallet picker (which wallet signs what). Primary is enough for now.
- Migrating the on-chain `agentId` when the primary changes — that lands in Layer 6.
- ENS/basename resolution (handled in 01-02).

## Acceptance

1. User with 2 linked wallets sees both, one marked primary.
2. Clicking the other "Primary" radio flips the flag in ≤1 request; refresh confirms persistence.
3. `users.wallet_address` matches the new primary after the click.
4. Disconnecting the primary while another wallet exists is blocked in the UI.
5. Disconnecting the only wallet clears `users.wallet_address` to null.
6. `node --check` passes on new files.
