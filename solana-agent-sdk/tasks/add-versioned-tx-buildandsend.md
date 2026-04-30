# Feature: VersionedTransaction support in `buildAndSend`

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

## The Problem

`src/tx/build.ts` only builds legacy `Transaction` objects:
```ts
const tx = new Transaction();
tx.recentBlockhash = blockhash;
tx.feePayer = wallet.publicKey;
tx.add(...budgetIxs, ...instructions);
```

Solana's current best practice is to use `VersionedTransaction` with Address Lookup Tables (ALTs). Jupiter swaps already return `VersionedTransaction` and handle this internally. But any SDK consumer building more complex transactions (multi-hop routes, compressed NFTs, DeFi protocols with ALTs) needs versioned tx support in `buildAndSend`.

## Fix

### `src/tx/build.ts`

Add `AddressLookupTableAccount` support to `BuildAndSendOptions`:

```ts
import {
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  type AddressLookupTableAccount,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

export interface BuildAndSendOptions {
  priorityFee?: number;
  cuLimit?: number;
  maxRetries?: number;
  meta?: TxMetadata;
  /**
   * Address Lookup Tables to include. When provided, builds a VersionedTransaction
   * (v0 message) instead of a legacy Transaction. Required for transactions that
   * reference more than 32 accounts.
   */
  lookupTables?: AddressLookupTableAccount[];
}
```

In `buildAndSend`, branch on whether `lookupTables` is provided:

```ts
for (let attempt = 0; attempt < maxRetries; attempt++) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  let tx: Transaction | VersionedTransaction;

  if (opts.lookupTables && opts.lookupTables.length > 0) {
    // Build versioned (v0) transaction
    const msg = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [...budgetIxs, ...instructions],
    }).compileToV0Message(opts.lookupTables);
    tx = new VersionedTransaction(msg);
  } else {
    // Build legacy transaction (default, backward compatible)
    const legacyTx = new Transaction();
    legacyTx.recentBlockhash = blockhash;
    legacyTx.lastValidBlockHeight = lastValidBlockHeight;
    legacyTx.feePayer = wallet.publicKey;
    legacyTx.add(...budgetIxs, ...instructions);
    tx = legacyTx;
  }

  try {
    return await wallet.signAndSendTransaction(tx, connection);
  } catch (err) {
    // ... retry logic unchanged
  }
}
```

### Update `estimateComputeUnits` in `src/tx/fees.ts`

It already uses `VersionedTransaction` for simulation (which is correct — v0 message works for simulation regardless of whether the final tx is legacy). No change needed.

### Export `AddressLookupTableAccount` type

It's a re-export from `@solana/web3.js` — consumers already have access. No additional export needed.

### Convenience helper

Add to `src/tx/build.ts`:

```ts
/**
 * Fetch Address Lookup Table accounts by their addresses.
 * Pass the result to buildAndSend's `lookupTables` option.
 */
export async function fetchLookupTables(
  connection: Connection,
  addresses: string[],
): Promise<AddressLookupTableAccount[]> {
  const { AddressLookupTableProgram, PublicKey } = await import("@solana/web3.js");
  const accounts = await Promise.all(
    addresses.map(async (addr) => {
      const res = await connection.getAddressLookupTable(new PublicKey(addr));
      if (!res.value) throw new Error(`Lookup table not found: ${addr}`);
      return res.value;
    }),
  );
  return accounts;
}
```

Use static imports (not dynamic `import()`):
```ts
import { ..., AddressLookupTableAccount } from "@solana/web3.js";
```

Export `fetchLookupTables` from `src/tx/index.ts` and `src/index.ts`.

## Verification

1. `npm run build` passes with zero errors
2. `buildAndSend` with no `lookupTables` still builds a legacy `Transaction` (backward compatible)
3. `buildAndSend` with `lookupTables: []` (empty array) also uses legacy Transaction
4. `buildAndSend` with a non-empty `lookupTables` array builds a `VersionedTransaction`
5. `fetchLookupTables` is exported from the main index
6. `AddressLookupTableAccount` type from `@solana/web3.js` is accepted (no new deps)
