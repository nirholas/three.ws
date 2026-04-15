---
mode: agent
description: "Complete SIWE wallet login end-to-end — nonce, verify, session, error states"
---

# Stack Layer 1: SIWE Wallet Login End-to-End

## Problem

Sign-In With Ethereum (SIWE) endpoints exist at [api/auth/siwe/nonce.js](api/auth/siwe/nonce.js) and [api/auth/siwe/verify.js](api/auth/siwe/verify.js) but the full flow is not yet wired up on the client. [public/login.html](public/login.html) and [public/wallet-login.js](public/wallet-login.js) exist but the happy path from "click Connect" → authenticated session is not reliably working end-to-end.

This is priority stack layer 1 (wallet auth 100%). Nothing else on the stack can ship without this working.

## Implementation

### Server (already partially exists — verify + harden)

1. `POST /api/auth/siwe/nonce` returns `{ nonce, issuedAt, expiresAt }`.
   - Store nonce in a short-TTL key (Upstash Redis, 5 min) bound to client IP + user agent.
   - Reject if called more than 10×/min per IP.
2. `POST /api/auth/siwe/verify` accepts `{ message, signature }`:
   - Parse SIWE message, extract nonce, verify nonce is live and not yet consumed.
   - Verify signature recovers to `message.address` using `ethers.verifyMessage`.
   - Consume nonce (delete from Redis).
   - Upsert row in `users` keyed by `wallet_address` (lowercase).
   - Issue JWT via the existing helper in [api/_lib/](api/_lib/). Set `auth` cookie (HttpOnly, Secure, SameSite=Lax, 30d).
   - Return `{ user: { id, wallet_address, handle } }`.

### Client ([public/wallet-login.js](public/wallet-login.js))

1. Detect injected wallet (`window.ethereum`) OR fall back to WalletConnect via `@walletconnect/ethereum-provider` (already a dep? check [package.json](package.json) — if not, use Privy which is already integrated).
2. On "Connect" click:
   - Request accounts.
   - Fetch `/api/auth/siwe/nonce`.
   - Build SIWE message: domain, address, statement, URI, version=1, chainId, nonce, issuedAt.
   - Request signature via `personal_sign`.
   - POST `{ message, signature }` to `/api/auth/siwe/verify`.
   - On success: redirect to `/dashboard/`.
3. Surface every failure with a concrete message ("Wallet rejected", "Nonce expired, retry", "Signature invalid").

### Database

`users` table must have: `id`, `wallet_address` (unique, lowercase), `handle`, `created_at`, `email` (nullable), `privy_did` (nullable for Privy flow). Add migration if missing.

### Session

Reuse `requireAuth()` from [api/_lib/](api/_lib/) — no new JWT code. Verify it accepts wallet-authed users (no email required).

## Validation

- Open [/login.html](public/login.html) in an incognito window with MetaMask.
- Click Connect → approve account → sign message → land on `/dashboard/` with a live session.
- Refresh `/dashboard/` — still authenticated.
- Hit `/api/auth/me` → returns `{ id, wallet_address, handle }`.
- Replay the same nonce → verify returns 400.
- Wait 6 minutes after fetching nonce → verify returns 400 ("nonce expired").
- `npm run build` passes.

## Do not do this

- Do NOT add a new auth library. Reuse `jose` + existing helper.
- Do NOT store the signature server-side beyond verification.
- Do NOT create a new `users` table — extend the existing one.
