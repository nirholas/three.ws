# 01-01 — Link a wallet to an existing email account

## Why it matters

SIWE sign-in creates a new passwordless user from a wallet. But a user who already registered with email needs a way to *add* a wallet to their existing account — otherwise they end up with two disconnected identities. This is required before wallet auth is "100%."

## Context

- SIWE endpoints already exist: [api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js), [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js).
- `user_wallets` table exists ([api/_lib/schema.sql](../../api/_lib/schema.sql)) — supports many wallets per user.
- Session auth helper: `getSessionUser` in [api/_lib/auth.js](../../api/_lib/auth.js).
- Dashboard shell: [public/dashboard/index.html](../../public/dashboard/index.html), [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js).

## What to build

### Endpoint — `api/auth/siwe/link.js`

- `POST`. Requires an active session (`getSessionUser`). 401 if none.
- Body: `{ message, signature }` (same SIWE shape as `/verify`).
- Verifies the signature against the SIWE message + burns the nonce exactly like `/verify`.
- On success: inserts into `user_wallets` bound to the current session's user_id.
  - If the address is already linked to a different user → 409 `wallet_already_linked`.
  - If already linked to *this* user → 200 `{ ok: true, wallet }` (idempotent).
- Mirrors the primary wallet to `users.wallet_address` only if the user has no primary wallet yet.

### Client — wallet linking on the dashboard

In [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) (or a new `public/dashboard/wallet-link.js` imported from the existing HTML), add:

- A "Connect wallet" button in the account section.
- Click → reuse the exact SIWE client flow from [public/wallet-login.js](../../public/wallet-login.js) but POST to `/api/auth/siwe/link` instead of `/verify`.
- Show the linked address (`0xabc…1234`) with a "Disconnect" button beside it.

### Endpoint — `DELETE /api/auth/siwe/link?address=0x…`

- Session-authed. Removes a `user_wallets` row owned by the caller. 404 if the address isn't linked to this user.

## Out of scope

- Multi-chain bookkeeping (one chain_id is enough).
- Re-using existing sessions across wallet changes (session stays; we're only mutating linked wallets).
- UI for selecting a "primary" wallet beyond the first one linked.
- Showing ENS names (follow-up).

## Acceptance

1. Sign in with email + password.
2. Click "Connect wallet" → sign SIWE → see the address appear in the account section.
3. Sign out. Open an incognito window. SIWE sign-in with that same wallet logs into the *existing* email account (not a new one).
4. Try to link that same wallet from a *different* email account → 409.
5. Click "Disconnect" → wallet row removed. SIWE with that wallet in a fresh session creates a new passwordless account.
6. `node --check` passes on new files.
