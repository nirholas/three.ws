# Band 1 — Wallet Auth, 100%

## The end state

A user lands on `3d.irish`, clicks **Sign in with wallet**, approves a MetaMask / Privy / WalletConnect signature, and now has a session. Every authenticated endpoint (`/api/avatars`, `/api/agents`, `/dashboard`) works for them. No email required. Email sign-in continues to work for existing accounts. A user can link a wallet to an existing email account.

## Current state (audit 2026-04-15)

- Wallet connect client-side works — `src/erc8004/agent-registry.js:32-57` via Privy + injected fallback — but it's only used for ERC-8004 agent registration, not user login.
- No SIWE endpoints (`/api/auth/siwe/nonce`, `/api/auth/siwe/verify` do not exist).
- `users` table has **no** `wallet_address` column (see `api/_lib/schema.sql`).
- No nonce storage table → replay attack risk if SIWE were bolted on naively.
- No "Sign in with wallet" button on the home page or login form.
- Session infra is solid: `__Host-sid` HttpOnly cookie, 30-day TTL, `getSessionUser(req)` pattern — see `api/_lib/auth.js`.

## Prompts in this band

| # | File | Depends on |
|---|---|---|
| 01 | [siwe-schema.md](./01-siwe-schema.md) | — |
| 02 | [siwe-nonce-endpoint.md](./02-siwe-nonce-endpoint.md) | 01 |
| 03 | [siwe-verify-endpoint.md](./03-siwe-verify-endpoint.md) | 01, 02 |
| 04 | [signin-ui.md](./04-signin-ui.md) | 02, 03 |
| 05 | [privy-backend-verify.md](./05-privy-backend-verify.md) | 03 |
| 06 | [link-wallet-to-account.md](./06-link-wallet-to-account.md) | 03 |

01 → 02 → 03 → 04 is the critical path. 05 and 06 can run in parallel with 04.

## Done = merged when

- Chrome + MetaMask → "Sign in with wallet" → signature prompt → back on the site as a signed-in user.
- Refresh the page → still signed in.
- Sign out → session cookie cleared, protected routes return 401.
- Same flow in Brave (injected) and with WalletConnect (mobile) both work.
- `document.cookie` shows `__Host-sid` after signin — not some custom cookie.
- `GET /api/auth/me` returns the wallet user record.
- Existing email-password users still work unchanged.

## Off-limits for this band

- Do not introduce a new auth library. Use `ethers` (already a dep) for `verifyMessage`/`recoverAddress`.
- Do not redesign the session model. Reuse `createSession` / `__Host-sid`.
- Do not change the `users` table primary key. Add the column, don't restructure.
