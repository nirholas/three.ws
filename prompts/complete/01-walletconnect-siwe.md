# 01 — WalletConnect → SIWE bridge

## Why

SIWE end-to-end already works via injected wallets (MetaMask) and Privy (see [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) and [src/erc8004/privy.js](../../src/erc8004/privy.js)). What's missing: an explicit, documented WalletConnect v2 path so a user on a mobile-only wallet can still sign in without Privy. Privy *bundles* WalletConnect internally, but there's no clean standalone path for devs who don't want Privy as a dep.

Closes the audit's only remaining wallet-auth gap.

## What to build

A single module that exposes:

```js
// src/auth/walletconnect-bridge.js
export async function signInWithWalletConnect({ projectId, chains } = {}) → { user, address }
export function getWalletConnectProvider() → EIP1193Provider | null
export async function disconnectWalletConnect() → void
```

Signature:

1. Lazy-load `@walletconnect/ethereum-provider` from a CDN (esm.sh) — **no new npm dep**. Use dynamic `import()` so this code only runs when the user clicks the WalletConnect button.
2. Read `projectId` from arg → `VITE_WALLETCONNECT_PROJECT_ID` env → `/api/config` fallback (already returns arbitrary public config; see [api/config.js](../../api/config.js) — add a key *only* if you must, otherwise read from VITE\_).
3. Connect provider, request `eth_requestAccounts`, then run the existing SIWE flow:
   - `GET /api/auth/siwe/nonce` → nonce
   - Build EIP-4361 message matching the format in [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) (domain = `location.host`, uri = `location.origin`, chainId from provider, version `1`, issuedAt ISO).
   - Sign via `provider.request({ method: 'personal_sign', params: [message, address] })`.
   - `POST /api/auth/siwe/verify` with `{ message, signature, address }`.
   - On success, set cookie (server does this), call `writeAuthHint(true)` from [src/account.js](../../src/account.js).
4. On failure, surface a typed error `{ code: 'wc/<stage>', message }` so the sign-in UI can show it.

Also add: `src/auth/walletconnect-bridge.test.html` — a minimal standalone page (not linked from the app) that instantiates the bridge, shows connect/sign-in/disconnect buttons, and logs results. Useful for manual smoke.

## Files you own

- Create: `src/auth/walletconnect-bridge.js`
- Create: `src/auth/walletconnect-bridge.test.html`
- Create: `src/auth/README.md` — documents env var `VITE_WALLETCONNECT_PROJECT_ID`, CDN version pinned, known issues.

## Files off-limits

- `api/auth/siwe/*` — consume as-is.
- `src/account.js`, `src/erc8004/privy.js` — read-only.
- `vite.config.js`, `vercel.json`, `package.json` — do not edit.

## Acceptance

- `node --check src/auth/walletconnect-bridge.js` passes.
- Opening `src/auth/walletconnect-bridge.test.html` via `npm run dev` → WC button opens modal, scan → connect → sign → `/api/auth/me` returns a user.
- The bridge does **not** throw when `projectId` is missing — it returns a clear error.

## Reporting

Files created, exact CDN URL pinned, WalletConnect version, any SIWE message format mismatch discovered against [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js).
