# Feature: `getTokenBalance` and `getTokenAccounts` on `SolanaAgent`

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

`src/agent.ts` contains the `SolanaAgent` class. It currently has:
- `getBalance()` — returns SOL balance in lamports
- `transferSol()`, `transferSpl()`, `swap()`, `getOrCreateAta()`

It is missing basic token balance reads.

## What to Build

Add two methods to `SolanaAgent` and two standalone functions to `src/actions/`:

### Standalone functions

**`src/actions/get-token-balance.ts`**

```ts
export interface TokenBalanceResult {
  mint: string;
  amount: string;       // raw base units
  decimals: number;
  uiAmount: string;     // human readable
  ata: string;          // ATA address
}

export async function getTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey | string,
): Promise<TokenBalanceResult | null>
```

- Derives the ATA for `owner` + `mint`
- Fetches the token account via `connection.getTokenAccountBalance(ata)`
- Returns `null` if the account doesn't exist (not an error)
- Returns `TokenBalanceResult` with all fields populated
- `uiAmount` should use BigInt-safe division (same pattern as `fix-bigint-precision-swap.md` recommends — `whole.frac` string format, no `Number()` on large values)

**`src/actions/get-token-accounts.ts`**

```ts
export interface TokenAccount {
  mint: string;
  ata: string;
  amount: string;       // raw base units
  decimals: number;
  uiAmount: string;
}

export async function getTokenAccounts(
  connection: Connection,
  owner: PublicKey,
): Promise<TokenAccount[]>
```

- Uses `connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })`
- Returns all token accounts with non-zero balance
- Filters out zero-balance accounts
- Uses `@solana/spl-token`'s `TOKEN_PROGRAM_ID` for the filter
- `uiAmount` uses BigInt-safe division

### `src/actions/index.ts`

Add exports:
```ts
export { getTokenBalance } from "./get-token-balance.js";
export type { TokenBalanceResult } from "./get-token-balance.js";
export { getTokenAccounts } from "./get-token-accounts.js";
export type { TokenAccount } from "./get-token-accounts.js";
```

### `src/agent.ts`

Add two methods:

```ts
/** Get SPL token balance. Returns null if the wallet has no account for that mint. */
getTokenBalance(mint: PublicKey | string): Promise<TokenBalanceResult | null> {
  return getTokenBalance(this.connection, this.wallet.publicKey, mint);
}

/** List all SPL token accounts with non-zero balance. */
getTokenAccounts(): Promise<TokenAccount[]> {
  return getTokenAccounts(this.connection, this.wallet.publicKey);
}
```

Import the functions at the top of `agent.ts`.

### `src/index.ts`

Add exports for the new types and functions:
```ts
export { getTokenBalance } from "./actions/get-token-balance.js";
export type { TokenBalanceResult } from "./actions/get-token-balance.js";
export { getTokenAccounts } from "./actions/get-token-accounts.js";
export type { TokenAccount } from "./actions/get-token-accounts.js";
```

## Verification

1. `npm run build` passes with zero errors
2. `SolanaAgent` has both `getTokenBalance(mint)` and `getTokenAccounts()` methods
3. Both standalone functions are exported from the main index
4. `getTokenBalance` returns `null` (not an error) when the ATA doesn't exist
5. `uiAmount` fields use BigInt-safe arithmetic — no `Number(bigint)`
