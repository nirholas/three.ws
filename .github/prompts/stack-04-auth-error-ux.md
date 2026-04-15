---
mode: agent
description: "Turn every auth failure into a clear, recoverable user-facing message"
---

# Stack Layer 1: Auth Error UX

## Problem

Today auth errors bubble up as generic "Login failed" with no indication of cause. Users silently fail and bounce. This layer is not shippable without a clear error UX.

## Implementation

### Catalog every auth error path

For each endpoint under [api/auth/](api/auth/), enumerate failure modes and map to an error code string:
- `WALLET_REJECTED` — user rejected signature
- `NONCE_EXPIRED` — SIWE nonce older than 5 min
- `NONCE_INVALID` — nonce not found / already consumed
- `SIGNATURE_INVALID` — recovered address does not match
- `CHAIN_MISMATCH` — client chainId doesn't match expected
- `RATE_LIMITED` — too many attempts
- `PRIVY_TOKEN_INVALID`
- `USER_BANNED` (future-proof)
- `NETWORK_ERROR` (client-side catch-all)

Server returns `{ error: { code, message } }` with HTTP status 400/401/429.

### Client error renderer

In [public/wallet-login.js](public/wallet-login.js) and [public/login.html](public/login.html), map each code to:
- A human message.
- A **recovery action** (button): "Retry", "Connect different wallet", "Switch network", "Sign in with email instead".

### Logging

Log every auth failure server-side with `user_id` (if known), `error.code`, and a request id. Expose via an internal endpoint `/api/_admin/auth-errors` (gated by an admin JWT claim) so we can see patterns.

### Analytics hook

Fire a `auth.failed` event with the code to whatever analytics sink is wired up (if any — check [src/app.js](src/app.js) for an existing event pattern; if none, skip — no new dep).

## Validation

- Reject signature in MetaMask → "Signature rejected. Retry?" with a button that restarts the flow.
- Set system clock 10 min forward during nonce exchange → "Nonce expired. Retry?" with a Retry button.
- Hammer the endpoint 20× in 10s → "Too many attempts. Wait 60s."
- Disconnect network during signature → "Network error. Check your connection."
- `npm run build` passes.

## Do not do this

- Do NOT use `alert()`. Inline the error in the login UI.
- Do NOT leak signature bytes, nonces, or stack traces to the client.
