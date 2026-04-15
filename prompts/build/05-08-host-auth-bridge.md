# 05-08 — Host embed: anonymous → authenticated bridge

**Branch:** `feat/host-auth-bridge`
**Stack layer:** 5 (Host embed)
**Depends on:** 05-03 (postMessage bridge), 01-* (wallet auth)

## Why it matters

A user viewing an agent inside Lobehub may want to *adopt* it — write to its memory, sign actions on its behalf, link it to their wallet. From inside an opaque-origin sandbox they can't use cookies. We need a popup-based SIWE flow that returns a short-lived bearer token to the embed via postMessage.

## Read these first

| File | Why |
|:---|:---|
| [api/auth/siwe/](../../api/auth/siwe/) | Existing SIWE endpoints — reuse, don't duplicate. |
| [src/host-bridge.js](../../src/host-bridge.js) | Bridge to extend. |
| [api/_lib/auth.js](../../api/_lib/auth.js) | Bearer token issuance — likely already supports JWT. |
| [public/wallet-login.js](../../public/wallet-login.js) | Existing SIWE client. |

## Build this

1. Create `public/auth/popup.html` — minimal page that runs the SIWE flow and posts the resulting bearer token back to `window.opener` via `postMessage`, then closes itself. Use the existing nonce + verify endpoints.
2. In `src/host-bridge.js`, handle `agent:request-auth` by opening the popup at `https://<host>/auth/popup?return=postmessage&origin=<embed-origin>`. Listen for the `auth:token { bearer, expiresAt }` reply.
3. Store the bearer in memory only (never `localStorage`/cookies — sandbox can't read them anyway).
4. Add an `Authorization: Bearer <token>` header to all subsequent backend calls from the embed.
5. Reject the token if it didn't come from the popup window we opened (use the popup's `name` as a one-time nonce).

## Out of scope

- Do not implement OAuth code flow — SIWE already works.
- Do not persist tokens across page reloads (re-auth each time is fine for v1).
- Do not silently elevate anonymous reads — every write requires explicit user click that opens the popup.

## Acceptance

- [ ] An anonymous embed user clicking "Adopt" triggers a popup.
- [ ] After SIWE signature, the popup closes and the embed transitions to authenticated state.
- [ ] Bearer token works for `POST /api/agent-actions` and `POST /api/agent-memory`.
- [ ] Token never crosses an origin boundary except popup ↔ opener.
- [ ] `npm run build` passes.

## Test plan

1. Open a scratch host page with the embed.
2. Click an Adopt button (wired to `protocol.emit({ type: 'request-auth' })`).
3. Verify popup opens, MetaMask prompt appears, sign.
4. Verify popup closes and the embed shows the user's wallet address.
5. Trigger a write action — confirm 200 from backend with the bearer.
