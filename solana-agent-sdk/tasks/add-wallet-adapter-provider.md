# Feature: WalletAdapterProvider — bridge from @solana/wallet-adapter

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

Package location: `/workspaces/3D-Agent/solana-agent-sdk/`
Package name: `@three-ws/solana-agent`

The `WalletProvider` interface (in `src/wallet/types.ts`) is:
```ts
export interface WalletProvider {
  readonly publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAndSendTransaction(tx: Transaction | VersionedTransaction, connection: Connection): Promise<string>;
}
```

## What to Build

Create `src/wallet/wallet-adapter.ts` — a `WalletAdapterProvider` class that wraps any `@solana/wallet-adapter-base` wallet adapter and makes it compatible with `WalletProvider`.

`@solana/wallet-adapter-base` is the standard wallet adapter interface used by Phantom, Solflare, Backpack, and every other Solana wallet in React/browser apps. Its relevant interface is:

```ts
// From @solana/wallet-adapter-base (do NOT install this package — use structural typing)
interface WalletAdapter {
  publicKey: PublicKey | null;
  signTransaction?<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions?<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
  sendTransaction(tx: Transaction | VersionedTransaction, connection: Connection, options?: SendTransactionOptions): Promise<string>;
  connected: boolean;
}
```

## Requirements

### `src/wallet/wallet-adapter.ts`

Use structural typing — do NOT add `@solana/wallet-adapter-base` as a dependency. Define a minimal `WalletAdapterLike` interface locally:

```ts
export interface WalletAdapterLike {
  publicKey: PublicKey | null;
  connected: boolean;
  signTransaction?<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  sendTransaction(tx: Transaction | VersionedTransaction, connection: Connection): Promise<string>;
}
```

The `WalletAdapterProvider` class:
- Constructor takes a `WalletAdapterLike`
- `get publicKey()` — throws `Error("Wallet not connected")` if `adapter.publicKey` is null
- `signTransaction(tx)` — delegates to `adapter.signTransaction(tx)`. Throws `Error("Wallet does not support signTransaction")` if the adapter doesn't implement it
- `signAndSendTransaction(tx, connection)` — delegates to `adapter.sendTransaction(tx, connection)`. Does NOT implement separate sign + send — uses the adapter's native `sendTransaction` which handles both internally (required for hardware wallets)

Also implement `MetaAwareWallet` — add `setNextMeta(meta: TxMetadata)` that stores metadata but since adapter wallets don't have a pending queue, just store it for reading (e.g. so a parent component can display it before calling the action). Keep it simple — store in an instance variable, expose `getNextMeta(): TxMetadata | null`.

### Export

Add to `src/wallet/index.ts`:
```ts
export { WalletAdapterProvider } from "./wallet-adapter.js";
export type { WalletAdapterLike } from "./wallet-adapter.js";
```

Add to `src/index.ts`:
```ts
export { WalletAdapterProvider } from "./wallet/wallet-adapter.js";
export type { WalletAdapterLike } from "./wallet/wallet-adapter.js";
```

### Usage example (for documentation — do not create a file, just make this work):
```ts
// In a React component with useWallet() from @solana/wallet-adapter-react:
const { wallet, sendTransaction, signTransaction, publicKey, connected } = useWallet();

const provider = new WalletAdapterProvider({
  publicKey,
  connected,
  signTransaction,
  sendTransaction,
});

const agent = new SolanaAgent({ wallet: provider, connection });
await agent.transferSol("9Wz...", 0.1);
```

## Verification

1. `npm run build` passes with zero errors
2. `WalletAdapterProvider` is exported from both `@three-ws/solana-agent` and `@three-ws/solana-agent/wallet`
3. `WalletAdapterProvider` satisfies the `WalletProvider` interface (TypeScript structural check)
4. `WalletAdapterProvider` satisfies the `MetaAwareWallet` interface
5. No new npm dependencies added to `package.json`
