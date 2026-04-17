# Task: Add CSRF protection to SIWE verify + tighten nonce entropy

## Context

Repo root: `/workspaces/3D-Agent`. Read [/CLAUDE.md](../../CLAUDE.md) and [api/CLAUDE.md](../../api/CLAUDE.md) first.

The SIWE flow at [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) is functionally correct but missing CSRF protection. `api/_lib/auth.js` already exports `verifyCsrfToken` — it is imported nowhere in `api/auth/siwe/*`. Nonce entropy in [api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js) is ~95 bits (16 alphanumeric chars); spec calls for ≥128.

## Files you own (exclusive)

- [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js)
- [api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js)

**Do not edit anything else.** If you discover a bug elsewhere, note it in your report; do not fix it.

## Deliverable

1. `verify.js` — call `verifyCsrfToken(req)` (from `api/_lib/auth.js`) at the top of the POST handler, before body parsing. Return `error(res, 403, 'invalid_request', 'CSRF check failed')` on fail.
2. `nonce.js` — bump alphabet length to 22 chars (≈128 bits). Keep the same alphabet set.
3. `nonce.js` — return a fresh CSRF token in the response body (`{ nonce, issuedAt, expiresAt, csrf }`). Use `issueCsrfToken(res)` from `api/_lib/auth.js` — it already sets the cookie, you just echo the token in JSON for the client.
4. Update [public/wallet-login.js](../../public/wallet-login.js) **only** to read `csrf` from the nonce response and send it as `x-csrf-token` header on the verify POST. This is the one allowed cross-file edit; restrict yourself to the two lines needed.

## Out of scope

- Do not change the SIWE parser.
- Do not change session cookie logic.
- Do not add new rate-limit presets.

## Verification

```bash
node --check api/auth/siwe/verify.js
node --check api/auth/siwe/nonce.js
node --check public/wallet-login.js
npm run build
```

Manually:
- `curl -sX POST /api/auth/siwe/verify -d '{}'` → 403 `invalid_request` with no CSRF.
- Fresh nonce → verify flow works end-to-end in the browser.

## Report back

Files changed, both commands run + output, any edge case you noticed in the SIWE parser (note, don't fix).
