# Feature: Memo attachment to transactions

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

## What to Build

The Solana Memo Program (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) allows attaching arbitrary UTF-8 text to any transaction. This is commonly used for tagging payments, adding notes, or including off-chain identifiers (e.g. invoice IDs, chat message IDs).

## Implementation

### `src/utils/memo.ts`

```ts
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/**
 * Build a Memo program instruction.
 * The memo string will be visible in explorer and indexers.
 * Max recommended length: 566 bytes (Solana transaction size limit).
 */
export function memoInstruction(memo: string, signerPublicKeys: PublicKey[] = []): TransactionInstruction {
  const data = Buffer.from(memo, "utf-8");
  return new TransactionInstruction({
    keys: signerPublicKeys.map((pk) => ({ pubkey: pk, isSigner: true, isWritable: false })),
    programId: MEMO_PROGRAM_ID,
    data,
  });
}
```

### Add `memo` to `BuildAndSendOptions`

`src/tx/build.ts` — add optional `memo` to `BuildAndSendOptions`:

```ts
export interface BuildAndSendOptions {
  priorityFee?: number;
  cuLimit?: number;
  maxRetries?: number;
  meta?: TxMetadata;
  lookupTables?: AddressLookupTableAccount[];
  /**
   * Optional UTF-8 memo string attached to the transaction.
   * Visible in Solana Explorer and on-chain indexers.
   */
  memo?: string;
}
```

In `buildAndSend`, if `opts.memo` is provided, add a memo instruction at the END of the instruction list (memo must be last per convention):

```ts
const allInstructions = opts.memo
  ? [...instructions, memoInstruction(opts.memo, [wallet.publicKey])]
  : instructions;
```

Use `allInstructions` for CU estimation and transaction building.

### Add `memo` parameter to transfer functions

**`src/actions/transfer-sol.ts`** — add `memo?: string` to `TransferSolParams`:
```ts
export interface TransferSolParams {
  to: PublicKey | string;
  amount: number;
  memo?: string;
}
```
Pass through to `buildAndSend` opts:
```ts
return buildAndSend(wallet, connection, [ix], {
  ...opts,
  memo: params.memo ?? opts?.memo,
  meta: ...
});
```

**`src/actions/transfer-spl.ts`** — same, add `memo?: string` to `TransferSplParams`.

### Add `memo` to LLM action schemas

**`src/solana-agent-kit/actions.ts`** — add optional `memo` to `transferSolAction` and `transferSplAction` schemas:
```ts
memo: z.string().max(500).optional().describe("Optional memo string attached to the transaction (visible on-chain)"),
```

Pass it through to the action params in the handler.

### Export

**`src/utils/memo.ts`** — export `memoInstruction` and `MEMO_PROGRAM_ID`.

**`src/index.ts`** — add:
```ts
export { memoInstruction, MEMO_PROGRAM_ID } from "./utils/memo.js";
```

## Verification

1. `npm run build` passes with zero errors
2. `memoInstruction` and `MEMO_PROGRAM_ID` exported from main index
3. `BuildAndSendOptions.memo` is optional (no breaking change)
4. `TransferSolParams.memo` and `TransferSplParams.memo` are optional
5. LLM action schemas have optional `memo` field
6. No new npm dependencies (Memo program is a Solana native program, no SDK needed)
