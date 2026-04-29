# src/auth

WalletConnect → SIWE bridge for mobile-wallet sign-in without Privy.

## Environment variable

```
VITE_WALLETCONNECT_PROJECT_ID=<your_wc_project_id>
```

Get a project ID at [cloud.walletconnect.com](https://cloud.walletconnect.com). Add it to `.env.local` for local development and to Vercel environment variables for production.

If the variable is missing the bridge returns a `wc/no_project_id` error immediately — it does not throw an unhandled exception.

## CDN

The WalletConnect provider is lazy-loaded at call time (never in the main bundle):

```
https://esm.sh/@walletconnect/ethereum-provider@2.17.0
```

**Pinned version:** `2.17.0`. To upgrade, update the `WC_CDN` constant at the top of `walletconnect-bridge.js` and re-run the smoke test.

## Usage

```js
import {
	signInWithWalletConnect,
	getWalletConnectProvider,
	disconnectWalletConnect,
} from './auth/walletconnect-bridge.js';

// Opens WC modal, signs SIWE message, verifies with server, sets session cookie.
const { user, address } = await signInWithWalletConnect();

// Get the raw EIP-1193 provider (after connect).
const provider = getWalletConnectProvider();

// Disconnect.
await disconnectWalletConnect();
```

## Error codes

All errors have an `err.code` of the form `wc/<stage>`:

| Code                  | Meaning                                     |
| --------------------- | ------------------------------------------- |
| `wc/no_project_id`    | `VITE_WALLETCONNECT_PROJECT_ID` not set     |
| `wc/load_failed`      | CDN import failed (network / CSP)           |
| `wc/init_failed`      | EthereumProvider.init() threw               |
| `wc/connect_rejected` | User closed modal or rejected session       |
| `wc/no_accounts`      | Provider returned no accounts after connect |
| `wc/nonce_failed`     | `/api/auth/siwe/nonce` request failed       |
| `wc/sign_rejected`    | User rejected personal_sign                 |
| `wc/verify_failed`    | `/api/auth/siwe/verify` returned an error   |

## Known issues

- **Domain validation in local dev:** `/api/auth/siwe/verify` validates that the SIWE `domain` field matches `APP_ORIGIN`. Ensure `.env.local` includes `APP_ORIGIN=http://localhost:3000` (matching the Vite dev port) or the verify call will fail with `invalid_domain`.
- **CSP + CDN:** If the app sets a strict `script-src` CSP, add `https://esm.sh` to the allowlist, or self-host the WC provider package.
- **QR modal on iOS Safari:** The WC modal's clipboard copy requires a user gesture; Safari blocks it otherwise. The QR scan path still works.

## Smoke test

Open [`walletconnect-bridge.test.html`](./walletconnect-bridge.test.html) via the dev server:

```
npm run dev
# navigate to http://localhost:3000/src/auth/walletconnect-bridge.test.html
```
