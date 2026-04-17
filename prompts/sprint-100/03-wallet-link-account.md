# 03 — Link / unlink wallet to existing account

## Why

An email user should be able to attach a wallet (and detach it) without creating a second account. Without this, SIWE-signin creates a split identity for users who already have an email account.

## Parallel-safety

You create two NEW endpoints. You do not touch SIWE nonce/verify or login/register. Uses the same `user_wallets` table that [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) already writes to.

## Files you own

- Create: `api/auth/wallet/link.js`
- Create: `api/auth/wallet/unlink.js`

## Read first

- [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) — confirm the `user_wallets` schema in use (`user_id`, `address`, `chain_id`, `is_primary`, `last_used_at`).
- [api/\_lib/auth.js](../../api/_lib/auth.js) — `getSessionUser`.
- [api/\_lib/db.js](../../api/_lib/db.js) — `sql` tag.

## Deliverable

### `POST /api/auth/wallet/link`

- Requires session cookie.
- Body: `{ message, signature }` — full SIWE message + signature, same format the verify endpoint consumes.
- Steps:
    1. Parse message, extract `address` and `nonce`.
    2. Look up + consume the nonce exactly like [verify.js](../../api/auth/siwe/verify.js) does.
    3. `ethers.verifyMessage(message, signature) === address` (case-insensitive).
    4. If the address is already linked to a DIFFERENT user → `409 wallet-taken`.
    5. Insert into `user_wallets` with `user_id = session.user.id`, `is_primary = false`.
    6. Return `{ ok: true, address, chainId }`.
- Rate limit: `10/10min per user`.

### `POST /api/auth/wallet/unlink`

- Requires session cookie.
- Body: `{ address }`.
- Steps:
    1. Verify the wallet row exists for this user. 404 if not.
    2. If this is the user's ONLY auth method (no password_hash AND this is the only wallet row), refuse with `409 last-auth-method`.
    3. Delete the row.
    4. Return `{ ok: true }`.
- If `is_primary` was true and other wallets exist, promote the most-recently-used remaining wallet to primary.

## Constraints

- Reuse the exact same nonce parsing / verify logic that [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) uses. If you refactor it into a shared helper, put the helper at `api/_lib/siwe.js`. If you'd rather inline to stay scoped, that's fine — note the duplication in the report.
- No new runtime deps. Use `ethers` since it's already a dep.

## Acceptance

- `node --check` clean.
- Manual: email-signup a user → call `/link` with a SIWE signature from a fresh wallet → `/auth/me` now returns the wallet address too. Call `/unlink` → it's gone.
- Trying to link a wallet already on another account returns `409 wallet-taken`.

## Report

- The refactor-or-inline decision on the SIWE parse logic.
- Whether you added `api/_lib/siwe.js` and what it exports.
