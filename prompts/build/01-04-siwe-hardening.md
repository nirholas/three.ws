# 01-04 — SIWE nonce hardening and rate-limit audit

## Why it matters

Wallet auth is user-facing and unauthenticated at the entry point. Nonce reuse, unbounded nonce generation, and missing rate limits are exactly the class of bugs that get a wallet-auth flow quietly drained via scripted enumeration. Before we expose SIWE to the real internet (Layer 5 host embeds will widen attack surface), close these gaps.

## Context

- Nonce mint: [api/auth/siwe/nonce.js](../../api/auth/siwe/nonce.js).
- Verify/burn: [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js).
- Link (from 01-01): `api/auth/siwe/link.js`.
- Shared rate limit: [api/_lib/rate-limit.js](../../api/_lib/rate-limit.js).

## What to build

### Nonce store invariants

Confirm (or add):

- Nonces stored with `(nonce, issued_at, consumed_at, client_ip_hash)`.
- TTL: 10 minutes. Expired nonces rejected with the same error as unknown nonces (no distinguishing timing).
- Single-use: `update … set consumed_at = now() where nonce = $1 and consumed_at is null returning 1` — verify on the `returning` row count, not on a prior select.
- A nonce is bound at mint time to a client IP hash (sha256 of IP + server salt). Verify/link rejects if the presenting IP hash differs. Document this: it breaks mobile networks that change IPs mid-flow; log at `info` and exempt if `X-SIWE-Allow-IP-Drift: 1` header is present AND the bound ENS name matches. If that logic feels fragile, drop the IP binding entirely and say so in the reporting.

### Rate limits

Apply via [api/_lib/rate-limit.js](../../api/_lib/rate-limit.js):

- `POST /api/auth/siwe/nonce` — 20 / 10min per IP, 5 / 10min per `(IP, requested-address)` if the client sends one.
- `POST /api/auth/siwe/verify` — 10 / 10min per IP, 5 / 10min per address.
- `POST /api/auth/siwe/link` — 5 / 10min per authenticated user.

Limits must fail closed with 429 and `Retry-After`.

### Message validation

In verify + link, explicitly check:

- `domain` equals the request's `Host` header (not `X-Forwarded-Host` unless the trusted proxy is our own).
- `uri` scheme is `https:` in production; allow `http://localhost` in `NODE_ENV !== 'production'`.
- `chainId` ∈ allowlist (1, 8453). Anything else → 400 with `unsupported_chain`.
- `issuedAt` within ±5 minutes of server time; `expirationTime`, if set, in the future.
- `statement` must match a server-defined canonical string (no user-supplied statements).

### Observability

Emit a structured log line on every `nonce/verify/link/rate-limit-trip` with `{ route, outcome, ip_hash, address_hash }`. Do not log raw addresses or IPs.

## Out of scope

- Adding a captcha.
- Geo-blocking.
- Switching from cookie sessions to JWT.
- Device fingerprinting.

## Acceptance

1. Manual replay of a used nonce → 400/401, never a successful login.
2. Parallel verify races for the same nonce: exactly one succeeds, the rest 401.
3. 25 rapid nonce requests from one IP: first ~20 succeed, rest 429 with `Retry-After`.
4. Tampered `domain`, `chainId`, or `issuedAt` in the signed message → verify rejects.
5. `node --check` passes on modified files.
6. Log lines for rate-limit trips are emitted and do not contain raw PII.
