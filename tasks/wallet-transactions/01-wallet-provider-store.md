# Task 01 — Wallet Provider Store

## Goal
Expose a reactive Svelte store that tracks which wallet is currently connected (type, address, chainId). Tool bodies and other components can read this store instead of parsing `currentUser` or polling `window.solana`/`window.ethereum` directly.

## Context
- `chat/src/stores.js` holds all app-wide Svelte stores. `currentUser` already exists but only holds the server-side user record — it does not carry which wallet type is connected or the live provider reference.
- `chat/src/walletAuth.js` exports `signInWithEVM()` and `signInWithSolana()`. Both return `{ user, wallet }` where `wallet = { type: 'evm'|'solana', address, chainId? }`.
- `chat/src/WalletConnect.svelte` calls those functions and then calls `loadCurrentUser()` but does not persist the wallet object anywhere.
- Tool bodies (eval'd JavaScript strings in `tools.js`) run in the browser and can call `import { get } from 'svelte/store'` or read a plain `window.__wallet` global.

## Changes Required

### 1. `chat/src/stores.js`
Add after the `currentUser` store definition:

```js
export const walletProvider = writable(null);
// Shape: { type: 'solana'|'evm', address: string, chainId?: number|string } | null
```

Add a helper used by tool bodies:
```js
export function getConnectedWallet() {
  return get(walletProvider);
}
```

Also expose it as a browser global so eval'd tool bodies can access it without imports:
At the bottom of the file add:
```js
if (typeof window !== 'undefined') {
  walletProvider.subscribe(w => { window.__wallet = w; });
}
```

### 2. `chat/src/WalletConnect.svelte`
- Import `walletProvider` from `./stores.js`
- After successful `signInWithEVM()`: call `walletProvider.set(wallet)`
- After successful `signInWithSolana()`: call `walletProvider.set(wallet)`
- On sign-out (when `signOut()` is called): call `walletProvider.set(null)`

### 3. `chat/src/walletAuth.js`
No changes needed — `signInWithEVM` and `signInWithSolana` already return the `wallet` object with the right shape. The WalletConnect component is responsible for storing it.

## Verification
- After connecting a Solana wallet, `window.__wallet` in the browser console should be `{ type: 'solana', address: '...' }`.
- After connecting an EVM wallet, `window.__wallet.type === 'evm'` and `window.__wallet.chainId` is present.
- After sign-out, `window.__wallet === null`.
- No other stores or components should be changed.
