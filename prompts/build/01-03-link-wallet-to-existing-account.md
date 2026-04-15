---
mode: agent
description: "Let a signed-in email user link a wallet without creating a second account"
---

# 01-03 · Link wallet to existing account

## Why it matters

If a user signs up with email then later connects a wallet, they get a second phantom account and their agent orphans. Breaks the onchain portability pillar (#6) — an agent minted under the phantom account can't be controlled from the real one.

## Prerequisites

- 01-01 and 01-02 verified.

## Read these first

- [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) — current "find or create user" branch.
- [api/_lib/auth.js](../../api/_lib/auth.js) — `getSessionUser`, `createSession`.
- Schema for `user_wallets` in the Neon DB (see [api/CLAUDE.md](../../api/CLAUDE.md) table list).

## Build this

1. **Modify `POST /api/auth/siwe/verify`** to check for an existing session *before* the find-or-create branch. If a session exists:
   - If `user_wallets.address` is unused → insert `(user_id=session.user_id, address, chain_id, is_primary=false)`. Return the *existing* user (do not rotate session).
   - If `user_wallets.address` belongs to the *current* user → idempotent success.
   - If `user_wallets.address` belongs to a *different* user → return `409 wallet_in_use` with a generic message (no user leakage).
2. **New client entry point** — add a "Link wallet" button to [public/dashboard/index.html](../../public/dashboard/index.html). Reuse [public/wallet-login.js](../../public/wallet-login.js) flow, but:
   - POST to the same `/api/auth/siwe/verify` endpoint (which now handles the linked case).
   - On success, show the linked address and update `users.wallet_address` if still null.
3. **List wallets** — add `GET /api/auth/wallets` returning `[{ address, chain_id, is_primary, last_used_at }]` for the current session. Use the session auth helper only — no bearer.
4. **Remove a wallet** — add `DELETE /api/auth/wallets/:address`. Cannot remove the primary if it's the only one. Update `users.wallet_address` to the next remaining primary if applicable.

## Out of scope

- UI redesign of the dashboard.
- Wallet-level permissions (signing scopes).
- Multi-chain handling beyond storing `chain_id`.
- ERC-8004 registration flow.

## Deliverables

- `api/auth/wallets.js` (new) exporting the list/delete handlers.
- Edits to `api/auth/siwe/verify.js` for the linked branch.
- A small UI block in `public/dashboard/index.html` + JS in `public/dashboard/dashboard.js` or a new file.
- `vercel.json` routes for the new endpoints.

## Acceptance

- Email user signs in → clicks Link Wallet → signs SIWE → same user gains the wallet, no new account.
- Cold wallet sign-in for a fresh address still works (creates new user, unchanged).
- Trying to link a wallet that belongs to a different user returns 409 without leaking who owns it.
- `node --check` + `npm run build` pass.
