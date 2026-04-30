# Feature: Fetch token decimals on-chain instead of guessing

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

## The Problem

`src/actions/swap.ts` contains:
```ts
function guessDecimals(mint: string): number {
  const KNOWN: Record<string, number> = {
    [SOL_MINT]: 9,
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": 6, // USDC mainnet
    // ...
  };
  return KNOWN[mint] ?? 9;  // defaults to 9 — wrong for most tokens
}
```

Most SPL tokens use 6 decimals, not 9. Using 9 as a fallback makes display values 1,000x too small for any unknown token. The display is only used in `TxMetadata` (shown to the user before they sign), so a wrong decimal count shows misleading amounts like "1,000,000 BONK" instead of "0.001 BONK".

## Fix

### `src/actions/swap.ts`

Replace the synchronous `guessDecimals` with an async function that fetches from chain, with a local cache for the session:

```ts
const decimalsCache = new Map<string, number>();

async function fetchDecimals(connection: Connection, mint: string): Promise<number> {
  if (mint === SOL_MINT) return 9;
  
  const cached = decimalsCache.get(mint);
  if (cached !== undefined) return cached;

  try {
    const { getMint, TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
    const { PublicKey } = await import("@solana/web3.js");
    const info = await getMint(connection, new PublicKey(mint), "confirmed", TOKEN_PROGRAM_ID);
    decimalsCache.set(mint, info.decimals);
    return info.decimals;
  } catch {
    // Unknown or token-2022 mint — default to 6 (more common than 9 for non-SOL tokens)
    return 6;
  }
}
```

**Important:** `@solana/spl-token` and `@solana/web3.js` are already direct dependencies — do NOT use dynamic `import()`. Import them statically at the top of the file as they already are.

Updated static version:
```ts
const decimalsCache = new Map<string, number>();

async function fetchDecimals(connection: Connection, mint: string): Promise<number> {
  if (mint === SOL_MINT) return 9;
  const cached = decimalsCache.get(mint);
  if (cached !== undefined) return cached;
  try {
    const info = await getMint(connection, new PublicKey(mint), "confirmed", TOKEN_PROGRAM_ID);
    decimalsCache.set(mint, info.decimals);
    return info.decimals;
  } catch {
    return 6;
  }
}
```

`getMint` and `TOKEN_PROGRAM_ID` are already imported from `@solana/spl-token` in the file — confirm they're in scope or add to the existing import.

### Update `jupiterSwap` signature

The function already has `connection: Connection` as a parameter. Change the metadata-building block from:
```ts
const inDecimals = guessDecimals(inputMint);
const outDecimals = guessDecimals(outputMint);
```
to:
```ts
const [inDecimals, outDecimals] = await Promise.all([
  fetchDecimals(connection, inputMint),
  fetchDecimals(connection, outputMint),
]);
```

### Remove `guessDecimals`

Delete the old `guessDecimals` function entirely. Remove the `KNOWN` constants map.

### Keep the well-known fallback for SOL

`SOL_MINT` is already handled explicitly in `fetchDecimals` (returns 9). The other known mints (USDC, USDT, mSOL) will be fetched from chain and cached — their correct values will be retrieved on first use.

## Verification

1. `npm run build` passes with zero errors
2. No `guessDecimals` function exists in the codebase
3. `fetchDecimals` returns 9 for `SOL_MINT` without an RPC call
4. `fetchDecimals` caches results — calling twice for the same mint only makes one RPC call
5. Fallback for unknown/failed mint is 6 (not 9)
