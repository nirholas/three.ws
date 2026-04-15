# Task 05 — Privy-issued token → backend verify

## Why this exists

Privy (already a client-side dep) gives us embedded wallets, email-based wallet login, and WalletConnect UX for free. Today it is used only on the ERC-8004 registration page. If we accept a Privy access token at the backend, we get:
- Users without a browser wallet can still sign in (Privy issues them an embedded wallet).
- Mobile / Brave / Safari users without MetaMask can still sign in via WalletConnect UX.
- Existing MetaMask users keep working because task 03 still accepts raw SIWE.

## Files you own

- Create: `api/auth/privy-verify.js`.
- Edit: `api/_lib/env.js` — add optional `PRIVY_APP_ID` and `PRIVY_APP_SECRET`. If both absent, this endpoint responds 501 and the SIWE flow from task 03 remains the only path.
- Edit: `vercel.json` — one route line.
- Edit: `src/wallet-auth.js` (from task 04) — add an alternative path `signInWithPrivy()` that calls Privy SDK, grabs the access token, and POSTs to `/api/auth/privy/verify`.

Do not rewrite task 03.

## Deliverable

### Endpoint

`POST /api/auth/privy/verify`

Body: `{ accessToken: "eyJ..." }` (Privy-issued JWT).

Steps:
1. If `env.PRIVY_APP_ID` or `env.PRIVY_APP_SECRET` unset → `501 { error: "privy not configured" }`.
2. Verify the JWT with Privy's JWKS. Use `jose` (already a dep). Fetch JWKS from `https://auth.privy.io/api/v1/apps/${appId}/jwks.json`, cache for 10 minutes in memory.
3. Require `aud === env.PRIVY_APP_ID` and `iss === 'privy.io'`. Reject expired tokens.
4. From the decoded token, read the linked wallet address (Privy puts it under custom claims — check `linked_accounts` / `wallet` depending on SDK version; document what you found).
5. Find-or-create a `users` row by `wallet_address` — same logic as task 03.
6. Issue the same `__Host-sid` session cookie via `createSession`.

### Client helper

In `src/wallet-auth.js`, add:

```js
export async function signInWithPrivy() {
  // Load @privy-io/js-sdk-core lazily; get accessToken; POST to /api/auth/privy/verify.
}
```

Wire a second button "Sign in with Privy" that appears only if `PRIVY_APP_ID` is present on the frontend (expose via an `/api/config` or a `<meta>` tag — do not inline the secret, only the public app id).

## Constraints

- Do not trust anything in the Privy JWT besides what's signed (no unsigned `info` blobs).
- Do not call Privy's REST API from every request — verify the JWT locally with JWKS.
- JWKS fetch must have a 3s timeout and a cached fallback.
- If the Privy token has no linked wallet, reject — we require a wallet for the identity binding. Document this in `Reporting`.

## Acceptance test

1. `node --check api/auth/privy-verify.js` passes.
2. With Privy configured: sign in via the Privy modal → `accessToken` retrieved → POST verify → session cookie set → signed in.
3. Without Privy configured: button is hidden; if someone manually hits the endpoint, they get 501.
4. Expired Privy token → 401.
5. Token signed by a different Privy app → 401.

## Reporting

- Which claim in the Privy JWT carries the wallet address — paste an example token payload.
- JWKS cache strategy and TTL.
- Graceful-degradation behavior when Privy is down (pick one, document it).
