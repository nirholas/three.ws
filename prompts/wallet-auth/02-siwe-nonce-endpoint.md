# Task 02 — SIWE nonce endpoint

## Why this exists

Before a user signs anything with their wallet, we must hand them a server-issued, single-use, time-limited nonce. If we let the client pick the nonce, we get replay attacks and cross-origin confusion.

## Files you own

- Create: `api/auth/siwe-nonce.js`
- Edit: `vercel.json` — add one route immediately after the other `/api/auth/*` routes.
- Edit: `api/_lib/rate-limit.js` — add a new preset `siweNonceIp`.

Do not touch `api/auth/login.js`, `api/auth/register.js`, `api/auth/me.js`, or `api/_lib/auth.js`.

## Deliverable

### Endpoint behavior

`POST /api/auth/siwe/nonce` (JSON body optional: `{ purpose?: "login" | "link", address?: "0x..." }`)

- Generates a 128-bit random value, base64url-encoded → `nonce`.
- Computes `expires_at = now + 5 minutes`.
- Inserts into `auth_nonces` with `purpose` defaulting to `'siwe-login'` and `issued_to` = lowercased `address` if provided.
- Responds `200 { nonce, expiresAt, domain, statement, chainId, version }` — include the full SIWE message fields so the client can build the exact string to sign.

Suggested `statement`: `"Sign in to 3D Agent. This request will not trigger a transaction or cost gas."`

Include `domain = new URL(env.APP_ORIGIN).host` and `chainId` as a server-advertised number (1 for mainnet, or whatever matches `env.SIWE_CHAIN_ID` — add that env var with a default of 1).

### Rate limiting

Add to `api/_lib/rate-limit.js`:

```js
siweNonceIp: (ip) => getLimiter('siwe:nonce:ip', { limit: 30, window: '10 m' }).limit(ip),
```

Call it first thing in the handler with `clientIp(req)`; on `!success`, return 429 with `retry_after`.

### Error shape

Reuse the existing `json(res, body, status)` and `error(res, code, msg, status)` helpers from `api/_lib/http.js` — don't roll your own.

### Vercel route

After the last `/api/auth/...` line in `vercel.json`:

```json
{ "src": "/api/auth/siwe/nonce", "dest": "/api/auth/siwe-nonce" },
```

## Constraints

- Use `crypto.randomBytes(16).toString('base64url')` for the nonce. No `Math.random()`, no client-supplied randomness.
- Do not return `Set-Cookie` here. Session issuance happens only after `verify`.
- Do not look up the user here. This endpoint is callable pre-auth.

## Acceptance test

1. `node --check api/auth/siwe-nonce.js` passes.
2. `curl -X POST $APP_ORIGIN/api/auth/siwe/nonce -H 'content-type: application/json' -d '{}'` returns `{ nonce, expiresAt, domain, statement, chainId, version }`.
3. The returned `nonce` is 22 chars (base64url of 16 bytes, no padding).
4. `SELECT * FROM auth_nonces ORDER BY created_at DESC LIMIT 1;` shows the row with `used_at IS NULL`.
5. Hammer the endpoint 40× from one IP — the 31st returns 429.

## Reporting

- Final `statement` string used (it appears in the user's wallet — copy matters).
- `chainId` default chosen and why.
- Any deviations from the EIP-4361 SIWE message schema.
