# Task: Write Tests for the Auth Flow

## Context

This is the `three.ws` 3D agent platform. Authentication is handled by three systems: email/password sessions (`api/auth/[action].js`), SIWE/Ethereum wallet sign-in (`api/auth/siwe/[action].js`), and OAuth 2.1 with PKCE (`api/oauth/[action].js`). The shared auth helpers live in `api/_lib/auth.js` (291 lines). Some partial tests exist but critical paths are uncovered.

## Goal

Write or extend vitest tests for the auth flow. Check what already exists at `tests/api/oauth-authorize.test.js`, `tests/api/oauth-token.test.js`, and `tests/api/siwe.test.js`, then fill gaps. New tests go in the same files or new ones in `tests/api/`.

## Files to Read First

- `api/_lib/auth.js` — all auth helpers: `getSessionUser`, `authenticateBearer`, `mintAccessToken`, `issueRefreshToken`, `rotateRefreshToken`, `createSession`, `csrfTokenFor`, `verifyCsrfToken`, `hashPassword`, `verifyPassword`
- `api/auth/[action].js` — login, logout, register, password reset, email verify
- `api/auth/siwe/[action].js` — SIWE nonce + verify
- `api/oauth/[action].js` — authorize, token, register, revoke, introspect
- `tests/api/oauth-authorize.test.js` — read this first to understand what's already tested
- `tests/api/oauth-token.test.js` — same
- `tests/api/siwe.test.js` — same

## What to Test (fill gaps only — don't duplicate existing coverage)

### Auth helpers (`api/_lib/auth.js`)
1. `mintAccessToken()` produces a JWT with correct `sub`, `scope`, `aud`, `exp` claims
2. `authenticateBearer()` returns the token payload for a valid JWT
3. `authenticateBearer()` throws/rejects for an expired JWT
4. `authenticateBearer()` throws/rejects for a tampered JWT signature
5. `csrfTokenFor()` + `verifyCsrfToken()` round-trip succeeds
6. `verifyCsrfToken()` fails for a mismatched session

### Email/password auth (`api/auth/[action].js`)
7. `POST /api/auth/login` with valid credentials returns session cookie
8. `POST /api/auth/login` with wrong password returns 401
9. `POST /api/auth/register` creates user and returns session cookie
10. `POST /api/auth/logout` clears session cookie

### SIWE (`api/auth/siwe/[action].js`)
11. `GET /api/auth/siwe/nonce` returns a fresh nonce and stores it (mock DB)
12. `POST /api/auth/siwe/verify` with a valid EIP-4361 message + signature creates a session (mock signature verification)
13. `POST /api/auth/siwe/verify` with an already-used nonce returns 401

### OAuth 2.1 (fill gaps in existing tests)
14. `POST /api/oauth/token` with `refresh_token` grant rotates the token and returns a new access token
15. `POST /api/oauth/token` with a revoked refresh token returns 400
16. `POST /api/oauth/introspect` returns `{ active: true }` for a valid token and `{ active: false }` for expired

## Approach

- Mock Neon DB with `vi.mock` or a test DB fixture
- Mock `bcrypt`/`hashPassword` for speed in unit tests
- For SIWE, mock the signature verification function — don't reconstruct real EIP-4361 signatures
- JWT tests can use a test secret; real JWTs are fine to mint in tests

## Success Criteria

- All new/updated test files pass with `npm test`
- No real DB or network calls
- Auth error paths (wrong password, expired token, reused nonce) all covered
