# Wiring the MWA wallet into three.ws

The `solana-mobile/src/` module is designed to be a single-import drop-in. It does nothing on desktop or in non-TWA contexts, and on Seeker it transparently swaps `window.solana` for an MWA-backed wallet that talks to the Seed Vault.

## 1. Install peer deps

From the repo root:

```bash
npm install --save \
  @solana-mobile/mobile-wallet-adapter-protocol \
  @solana-mobile/mobile-wallet-adapter-protocol-web3js
```

`@solana/web3.js` is already a transitive dep of `agent-payments-sdk` and `pump-fun-skills`; nothing else to add.

## 2. Boot the adapter from an app entry

Pick the lowest entry point that runs on every page that signs transactions. For three.ws, the natural place is `src/app.js` (or whichever script is first in the bundle graph for `home.html`, `agent-detail.html`, `account.html`, etc.).

```js
// At the very top of src/app.js, before any wallet code runs:
import './solana-mobile/src/index.js';
```

That's it. On Seeker, `window.solana` is now an `MwaWallet`. On every other platform, the import is a no-op.

## 3. No changes needed to existing call sites

The existing call sites already use the Phantom-shaped API:

- `src/wallet.js` reads `window.solana`, calls `.connect()`, `.on('connect'|'disconnect', …)`.
- `src/onchain/adapters/solana.js` calls `provider.signMessage(bytes, 'utf8')` and posts to `/api/auth/siws/{nonce,verify}`.

Those work unchanged. The `MwaWallet` exposes the same shape; `signMessage` returns `{ signature: Uint8Array }`, `signTransaction` returns a transaction of the same constructor as the input, etc.

The only call that changes shape is `provider.isPhantom` — we deliberately set it to `false` so legacy "only Phantom" branches don't try to treat the MWA wallet as Phantom. If you have code that gates on `isPhantom`, replace those checks with `provider.isThreeWs || provider.isPhantom`.

## 4. (Optional) Surface "Sign in with Seed Vault" affordances

If you want the in-product UI to read "Sign in with Seed Vault" instead of "Connect wallet" when the user is on Seeker:

```js
import { isSolanaMobileTwa, isSolanaMobileDevice } from './solana-mobile/src/seeker-detect.js';

const label = isSolanaMobileTwa() || isSolanaMobileDevice()
  ? 'Sign in with Seed Vault'
  : 'Connect wallet';
```

`isSolanaMobileTwa()` is strict (returns true only inside the dApp Store app). `isSolanaMobileDevice()` is loose (returns true on any Seeker, even in regular Chrome). Use the loose one for affordance hints, the strict one for behavioural changes.

## 5. Server-side: nothing changes

The signatures that `MwaWallet.signMessage` produces are standard ed25519 over the SIWS message, which is exactly what `/api/auth/siws/verify` already validates. No server changes required.

## 6. Testing locally

You cannot test MWA without a real Solana Mobile device. What you _can_ test on desktop:

```js
// In any browser console on https://three.ws:
import('/src/solana-mobile/src/seeker-detect.js').then(m => console.log({
  twa: m.isSolanaMobileTwa(),
  device: m.isSolanaMobileDevice(),
}));
// Both should be false on desktop.
```

For end-to-end testing, build the APK with `scripts/build-apk.sh`, sideload it via `adb install build/three-ws-release.apk`, and run through the flows on a Seeker.

## 7. Failure modes & how the wrapper handles them

| Scenario                                | Behaviour                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| User cancels the Seed Vault sheet       | `signMessage` / `signTransaction` rejects with the underlying MWA error; `.code` is `4001` if recognisable. |
| Auth token revoked (e.g. wallet wiped)  | `reauthorize` fails → wrapper clears `sessionStorage` and emits `disconnect`. Next call prompts. |
| MWA library fails to load (offline)     | `loadTransact()` rejects; the caller sees a `MwaWallet#connect` rejection with the original error.|
| Page reloads mid-session                | `sessionStorage` retains `authToken`; next sign uses `reauthorize` (no prompt for the user).      |
| Two tabs of the TWA simultaneously open | MWA serialises transactions per app — second tab waits for the first to release the connection.   |
