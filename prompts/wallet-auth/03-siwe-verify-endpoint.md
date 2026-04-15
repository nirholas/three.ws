# Task 03 — SIWE verify endpoint

## Why this exists

The user signs the SIWE message client-side. The server must:
1. Recover the signing address.
2. Validate the nonce is ours, unused, unexpired.
3. Bind that address to a user row (find-or-create).
4. Issue our standard `__Host-sid` session cookie.

Without this, a signed message is meaningless to the rest of the app.

## Files you own

- Create: `api/auth/siwe-verify.js`.
- Edit: `vercel.json` — one route line.
- Edit: `api/_lib/rate-limit.js` — add `siweVerifyIp` preset.

Do not touch existing auth handlers.

## Deliverable

### Endpoint behavior

`POST /api/auth/siwe/verify`

Body:
```json
{
  "message": "<full EIP-4361 message the user signed>",
  "signature": "0x...",
  "purpose": "login"
}
```

Steps:

1. IP rate limit: `siweVerifyIp` (60 / 10m). On fail → 429.
2. Parse the SIWE message. Extract: `domain`, `address`, `statement`, `uri`, `version`, `chainId`, `nonce`, `issuedAt`, `expirationTime`.
   - Minimum viable parser: regex out the fields. No new dep.
3. Reject if `domain !== new URL(env.APP_ORIGIN).host`.
4. Reject if `version !== '1'`.
5. Reject if `expirationTime` is present and past, or if `issuedAt` is >10 min old.
6. Recover signer: `ethers.verifyMessage(message, signature)` (ethers v6 is already a dep). Reject if `recovered.toLowerCase() !== address.toLowerCase()`.
7. `SELECT * FROM auth_nonces WHERE nonce = $1 FOR UPDATE` inside a transaction. Reject if row absent, `expires_at < now`, or `used_at IS NOT NULL`. Then `UPDATE auth_nonces SET used_at = now() WHERE nonce = $1`.
8. Find-or-create user:
   - `SELECT * FROM users WHERE lower(wallet_address) = lower($1)`.
   - If missing, `INSERT INTO users (id, wallet_address, wallet_chain_id, wallet_linked_at, created_at) VALUES (...)`. `email` stays NULL.
9. Issue session: reuse `createSession({ userId, userAgent, ip })` from `api/_lib/auth.js`. Set `__Host-sid` cookie with the same attributes the email login uses.
10. Respond `200 { user: { id, walletAddress, chainId, createdAt } }`.

### Rate limit preset

```js
siweVerifyIp: (ip) => getLimiter('siwe:verify:ip', { limit: 60, window: '10 m' }).limit(ip),
```

### Route

```json
{ "src": "/api/auth/siwe/verify", "dest": "/api/auth/siwe-verify" },
```

## Constraints

- Use only `ethers` for signature verification — no new deps.
- Treat the SIWE message as untrusted. Never `eval`, never pass it to `new Function`. Parse with regex/split only.
- Enforce the domain check. An attacker tricking the user to sign a message bound to another host must not succeed here.
- Do NOT auto-link the wallet to an email user. If the wallet is not known, create a **new** wallet-only user. Linking is task 06.
- Return a generic error message on all failures (`{ error: "invalid signature" }`). Do not leak which specific check failed — that helps attackers.

## Acceptance test

1. `node --check api/auth/siwe-verify.js` passes.
2. End-to-end from the browser: fetch `/api/auth/siwe/nonce`, build SIWE message, sign with MetaMask, POST to `/api/auth/siwe/verify` → receive `200` with `Set-Cookie: __Host-sid=...`.
3. `GET /api/auth/me` with that cookie returns the wallet user.
4. Replay the same `{message, signature}` → `400`.
5. Tamper with one byte of the signature → `400`.
6. Sign a message with `domain = evil.com` → `400`.
7. Database shows the `auth_nonces` row with `used_at` set.

## Reporting

- Exact SIWE parser used (paste the regex/function).
- Any deviations from EIP-4361 and why.
- Session cookie attributes (should match email login exactly).
