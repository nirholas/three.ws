# Fix: Duplicate `PendingTx` interface definition

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

## The Problem

`PendingTx` is defined identically in two files:

**`src/wallet/browser-server.ts` (lines 24-30):**
```ts
export interface PendingTx {
  id: string;
  transaction: string;
  versioned: boolean;
  createdAt: number;
  meta?: TxMetadata;
}
```

**`src/wallet/browser-client.ts` (lines 29-35):**
```ts
export interface PendingTx {
  id: string;
  transaction: string;
  versioned: boolean;
  createdAt: number;
  meta?: TxMetadata;
}
```

These are structurally identical today, but if either is updated (e.g. adding a new field), the other will silently diverge. The browser client already imports `TxMetadata` from `./types.js` — it should import `PendingTx` from `./browser-server.js` instead of re-defining it.

## Fix

### `src/wallet/browser-client.ts`

1. Remove the local `PendingTx` interface definition
2. Import `PendingTx` from `./browser-server.js`:

```ts
import type { PendingTx } from "./browser-server.js";
```

This import already exists for `TxMetadata` from `./types.js`, so the pattern is established.

### `src/wallet/index.ts`

The `PendingTx` type is currently exported from `browser-server.ts` via the index:
```ts
export type { BrowserWalletOptions, PendingTx } from "./browser-server.js";
```
This is already correct — no change needed here.

### Verify no circular imports

`browser-client.ts` imports from `browser-server.ts`. Check that `browser-server.ts` does NOT import from `browser-client.ts`. It should not — `browser-server.ts` only imports from `./types.js` and `@solana/web3.js`.

## Verification

1. `npm run build` passes with zero errors
2. `PendingTx` is defined exactly once — in `src/wallet/browser-server.ts`
3. `src/wallet/browser-client.ts` imports `PendingTx` from `./browser-server.js`
4. No change to the shape or fields of `PendingTx`
