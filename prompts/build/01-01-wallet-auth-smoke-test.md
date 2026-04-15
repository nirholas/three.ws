---
mode: agent
description: "Smoke-test the SIWE wallet login end-to-end and patch any breakage"
---

# 01-01 · Wallet auth smoke test

## Why it matters

Wallet auth is pillar 1 of the product stack. Until MetaMask → session cookie → `/api/agents/me` returns the user's agent works 100% on a fresh browser, **nothing else ships**. Selfie → agent, edit, embed, onchain — all downstream of this.

SIWE endpoints and `wallet-login.js` are in place (2026-04-15). This prompt is a verification pass: does the whole loop actually work in a cold browser, and what's broken?

## Prerequisites

- `npm run dev` runs without errors on :3000.
- A MetaMask-like wallet extension available in the test browser (or a headless signer — see below).
- Neon `DATABASE_URL` pointed at a writable DB with the schema applied.

## Read these first

- [public/login.html](../../public/login.html) — current login page markup.
- [public/wallet-login.js](../../public/wallet-login.js) — SIWE client flow.
- [api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js) — nonce issuance.
- [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) — signature verification + session issuance.
- [api/_lib/auth.js](../../api/_lib/auth.js) — `createSession`, `sessionCookie`, `getSessionUser`.
- [api/agents.js](../../api/agents.js) — `/api/agents/me` bootstrap that runs on every page load.

## Build this

Execute the following and report findings. For anything broken, patch it in the same PR unless it's out of scope (see below).

1. **Cold browser signin path** — private window → `/login` → click wallet → sign → land on `/dashboard/`.
   - Expected: `users` row + `user_wallets` row created on first attempt. Session cookie set. `/api/auth/me` returns the user.
2. **Repeat login path** — sign out → sign back in with the same wallet.
   - Expected: existing user reused via `user_wallets.address` lookup. No duplicate row. Session rotates (old one destroyed before new one issued).
3. **Nonce burn** — capture a valid `(message, signature)` from step 1 and `POST /api/auth/siwe/verify` with it a second time.
   - Expected: `nonce_reused` 400, no new session.
4. **Domain binding** — craft a SIWE message with a wrong `domain:` line and submit.
   - Expected: `invalid_domain` 400.
5. **Agent bootstrap** — after login, confirm `GET /api/agents/me` returns an agent (auto-created on first call). Confirm the client in [src/account.js](../../src/account.js) / [src/agent-identity.js](../../src/agent-identity.js) picks it up.
6. **Anonymous path** — hit `/` with no session; `/api/agents/me` must return `{ agent: null }` (not 401).

## Patching rules

- If any step fails due to a schema mismatch, inspect [api/_lib/db.js](../../api/_lib/db.js) and the migration files; do not invent new columns.
- If `APP_ORIGIN` / `ISSUER` env vars are missing, document what's needed in the final report — do **not** hard-code values.
- If the CSP on `/login` blocks `https://esm.sh`, either move `wallet-login.js` into the Vite bundle entry, or widen the CSP for that page only. Prefer bundling.

## Out of scope

- Adding a new wallet provider (WalletConnect, Coinbase) — save for later prompt.
- Refactoring the SIWE message to the `siwe` npm package — the hand-rolled parser is fine.
- Any UI redesign of `/login.html`.
- Touching ERC-8004 registration.

## Deliverables

- A short "what I verified / what I fixed" report in the PR description (or chat reply) with one line per step above.
- Any patches are minimal and scoped to bugs found during the five checks.

## Acceptance

- All six steps above pass on a cold private window.
- `node --check` passes on every modified `.js` file.
- `npm run build` passes.
