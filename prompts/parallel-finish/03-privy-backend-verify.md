# Task: Server-side Privy JWT verification endpoint

## Context

Repo root: `/workspaces/3D-Agent`. Read [/CLAUDE.md](../../CLAUDE.md) and [api/CLAUDE.md](../../api/CLAUDE.md) first.

Today the Privy client path ([public/wallet-login.js](../../public/wallet-login.js)) uses Privy only to surface wallet providers; the trust chain remains raw SIWE. We want a second supported flow: a user with a Privy session can mint a 3D-Agent session by presenting their Privy identity token server-side, without running SIWE again. This avoids an extra wallet signature for returning users.

Privy provides a verifier — their JWKS endpoint is at `https://auth.privy.io/api/v1/apps/{APP_ID}/jwks.json`. The identity token is sent as a bearer header.

## Files you own (exclusive — all new)

- `api/auth/privy/verify.js` — `POST /api/auth/privy/verify` — accepts `{ idToken }` in body, verifies against Privy JWKS, extracts the linked wallet address, find-or-creates the user + `user_wallets` record, issues a 3D-Agent session cookie.
- `api/_lib/privy.js` — JWKS fetch + cache + JWT verification helper. Exported `verifyPrivyIdToken(token) → { userId, walletAddress, email?, iat, exp }`.

**Do not edit** `api/_lib/auth.js`, `public/wallet-login.js`, or any SIWE file. If you need a helper that's almost-but-not-quite in `api/_lib/auth.js`, duplicate the tiny bit you need into `api/_lib/privy.js`.

## Conventions (from api/CLAUDE.md)

- `sql` from `api/_lib/db.js`.
- `json()` / `error()` / `wrap()` / `cors()` from `api/_lib/http.js`.
- Use the existing `createSession` from `api/_lib/auth.js` (this is an import-only use, not an edit).
- ESM, tabs (4-wide), single quotes. No TypeScript.
- Validate input with Zod (already a dep — see other endpoints for pattern).

## Requirements

1. **JWKS cache.** In-process Map keyed by `kid`. TTL 60 min. Refresh on cache miss.
2. **JWT verification.** Use `jose` (already in `node_modules` — verify, else fall back to hand-rolled with `crypto.verify()`). Algorithm: ES256 (Privy's choice). Issuer: `privy.io`. Audience: the `PRIVY_APP_ID` env var.
3. **Rate limit.** Use `limits.authIp(ip)` from `api/_lib/rate-limit.js`.
4. **User resolution.** Privy `sub` → `user_wallets.privy_user_id` (add this column if missing; schema file is `api/_lib/schema.sql` — **do not edit the schema**, instead check for the column and if missing, return a clear 501 with `schema_migration_required`). The user's wallet address is in the `linked_accounts` claim under `type: 'wallet'`.
5. **Session issuance.** Reuse `createSession(res, userId)` from `api/_lib/auth.js`.
6. **Response shape.** `{ user: { id, email }, wallet: { address, chain_id } }`.
7. **Errors.** Return typed error codes: `invalid_token`, `expired_token`, `wrong_audience`, `no_wallet_linked`, `schema_migration_required`.

## Out of scope

- Do not add the Privy flow to the login page UI (that's a separate integration step).
- Do not change `PRIVY_APP_ID` env resolution logic elsewhere.
- Do not implement email-only Privy sessions (wallet-less). Return `no_wallet_linked` if the Privy token has no wallet.

## Verification

```bash
node --check api/auth/privy/verify.js
node --check api/_lib/privy.js
npm run build
```

Manual smoke test (assuming you have a Privy dev tenant):

```
curl -X POST localhost:3000/api/auth/privy/verify -H 'content-type: application/json' \
  -d '{"idToken":"<paste>"}'
```

Expected: 200 + `Set-Cookie: __Host-sid=...` and JSON body; 401 `invalid_token` on a garbage token.

## Report back

Files created, verification output, whether `user_wallets.privy_user_id` exists today (check schema file to determine — do not add it), and what env vars this endpoint needs (`PRIVY_APP_ID`, any others).
