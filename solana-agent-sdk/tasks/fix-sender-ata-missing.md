# Fix: `transferSpl` silently fails when sender has no ATA

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

## The Bug

`src/actions/transfer-spl.ts` derives the sender's ATA address but never checks if the account exists on-chain. If the sender doesn't have a token account for that mint, the `TransferChecked` instruction is still added and the entire transaction fails on-chain with a cryptic `AccountNotFound` error from the RPC.

**Current code (lines 38-49):**
```ts
const senderAta = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const receiverAta = getAssociatedTokenAddressSync(mint, to, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

const receiverInfo = await connection.getAccountInfo(receiverAta);
if (!receiverInfo) {
  // creates receiver ATA ✓
}
// sender ATA never checked ← bug
```

**Also broken (line 58):**
```ts
const uiAmount = (Number(params.amount) / 10 ** mintInfo.decimals).toString();
```
`Number()` on a `bigint` loses precision for amounts > `2^53`. Use BigInt arithmetic instead.

## Fix

### `src/actions/transfer-spl.ts`

**1. Check sender ATA exists and has sufficient balance before building the transaction:**

After deriving both ATAs, fetch both account infos (can do in parallel):
```ts
const [senderInfo, receiverInfo] = await Promise.all([
  connection.getAccountInfo(senderAta),
  connection.getAccountInfo(receiverAta),
]);

if (!senderInfo) {
  throw new Error(
    `Sender has no token account for mint ${mint.toBase58()}. ` +
    `Create an ATA first or ensure the sender holds this token.`
  );
}
```

**2. Fix BigInt precision in uiAmount display (line 58):**

Replace `Number(params.amount)` with BigInt division:
```ts
// Safe for any token amount
const decimals = BigInt(mintInfo.decimals);
const divisor = 10n ** decimals;
const whole = params.amount / divisor;
const frac = params.amount % divisor;
const uiAmount = decimals === 0n
  ? whole.toString()
  : `${whole}.${frac.toString().padStart(Number(decimals), "0").replace(/0+$/, "") || "0"}`;
```

**3. Keep receiver ATA creation logic as-is** — it's correct.

**Note:** Do not add a balance sufficiency check (i.e., don't fetch token balance to compare against `params.amount`). That would add an extra RPC call and create a TOCTOU race. The on-chain error is the appropriate gate for insufficient balance. The sender ATA existence check is sufficient to prevent the confusing `AccountNotFound` error.

## Verification

1. `npm run build` passes with zero errors
2. `transferSpl` throws a clear `Error` with message containing "no token account" when sender has no ATA
3. `uiAmount` uses BigInt arithmetic — no `Number(bigint)` call
4. `receiverInfo` check and ATA creation logic is unchanged
