# 01-02 — Dashboard account section: wallets, email, claim identity

## Why it matters

Wallet-only users (created via SIWE with no email) need a way to add an email + password later so they can recover their account if they lose wallet access. And all users need to see which wallets are linked. This closes the "account" loop for the wallet auth foundation.

## Context

- Wallet-only users are created by [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) with a synthesized email `wallet-0x…@wallet.local`.
- Dashboard entry: [public/dashboard/index.html](../../public/dashboard/index.html), [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js).
- `users` schema: [api/_lib/schema.sql](../../api/_lib/schema.sql) — `email citext unique`, `password_hash nullable`.
- Password hashing: `hashPassword` in [api/_lib/auth.js](../../api/_lib/auth.js).

## What to build

### Endpoint — `api/auth/claim-identity.js`

Single endpoint: `POST /api/auth/claim-identity`. Session-authed.

Body: `{ email, password, display_name? }`.

Behavior:
- Reject if the user already has a real email (anything that doesn't match `/^wallet-0x[a-f0-9]{40}@wallet\.local$/`). Return 400 `already_claimed`.
- Reject if the target email is taken by another user. Return 409 `email_taken`.
- Hash password, update the row: `email`, `password_hash`, `display_name` (if provided).
- Return `{ user: { id, email, display_name, plan } }`.

### Account panel in dashboard

Add an **Account** section to the dashboard:

- Shows: display name (editable), email (editable if `wallet-*@wallet.local`, read-only otherwise), plan, and a "Linked wallets" list.
- If the email is synthesized (wallet-only user), show a prominent "Claim your account — set an email and password" form that posts to `/api/auth/claim-identity`.
- For all users: show linked wallets (GET `/api/auth/siwe/link` — see sibling prompt `01-01`). Each row: address (copy button), chain_id if present, "Disconnect" button.
- "Connect wallet" button appears if no wallet is linked.

### Endpoint — `GET /api/auth/siwe/link`

Returns `{ wallets: [{ address, chain_id, is_primary, created_at, last_used_at }] }`. Session-authed. Use this for the list.

## Out of scope

- Changing password flow for already-claimed accounts.
- Email verification emails.
- Plan upgrades UI.

## Acceptance

1. Sign in with wallet only. Dashboard shows "Claim your account" prompt with the `wallet-0x…@wallet.local` placeholder visible.
2. Submit email + password → account updated. Log out, log in with email/password → works.
3. The same user can still SIWE-sign-in with the same wallet → same account.
4. A wallet user without claiming can still use dashboard normally (avatars, etc.).
5. Linked wallets list is accurate. Disconnect works. Connect flow works.
6. `node --check` passes.
