# Feature: SOL staking actions (stake, unstake, get stake)

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

Staking is one of the most common Solana operations. This task adds native SOL staking support via the Solana Stake Program — no third-party protocols.

## What to Build

### `src/actions/stake.ts`

Three functions:

**1. `stakeSOL` — delegate SOL to a validator**
```ts
export interface StakeSolParams {
  /** Amount of SOL to stake (not lamports) */
  amount: number;
  /** Validator vote account address */
  voteAccount: PublicKey | string;
}

export interface StakeSolResult {
  signature: string;
  /** The new stake account address */
  stakeAccount: string;
}

export async function stakeSOL(
  wallet: WalletProvider,
  connection: Connection,
  params: StakeSolParams,
  opts?: BuildAndSendOptions,
): Promise<StakeSolResult>
```

Implementation:
- Generate a new `Keypair` for the stake account (ephemeral — its private key is discarded after creating, since it's owned by the stake program)
- Build instructions: `SystemProgram.createAccount` → `StakeProgram.initialize` → `StakeProgram.delegate`
- Sign the transaction with BOTH the wallet keypair AND the stake account keypair (the stake account needs to sign its creation). Note: `WalletProvider` only signs with one key — use `buildAndSend` but also add the stake account as a partial signer. For the browser wallet case, the stake account keypair can sign locally before sending to the browser.
- Actually: since we need the stake account to sign too, and `buildAndSend` doesn't support extra signers, build the transaction manually here rather than using `buildAndSend`.
- Metadata: `{ label: "Stake X SOL", kind: "custom", amountIn: { amount, symbol: "SOL", uiAmount: X } }`

**2. `unstakeSOL` — deactivate a stake account**
```ts
export interface UnstakeSolParams {
  /** Stake account address to deactivate */
  stakeAccount: PublicKey | string;
}

export async function unstakeSOL(
  wallet: WalletProvider,
  connection: Connection,
  params: UnstakeSolParams,
  opts?: BuildAndSendOptions,
): Promise<string> // returns signature
```

- Builds a `StakeProgram.deactivate` instruction
- Uses `buildAndSend`
- Note: deactivation takes ~1 epoch (2-3 days) before the SOL is withdrawable

**3. `getStakeAccounts` — list all stake accounts**
```ts
export interface StakeAccountInfo {
  address: string;
  lamports: number;
  state: "initialized" | "delegated" | "deactivating" | "inactive";
  voteAccount?: string;
  activationEpoch?: number;
  deactivationEpoch?: number;
}

export async function getStakeAccounts(
  connection: Connection,
  owner: PublicKey,
): Promise<StakeAccountInfo[]>
```

- Uses `connection.getProgramAccounts(StakeProgram.programId, { filters: [{ memcmp: { offset: 44, bytes: owner.toBase58() } }] })`
- Parses the stake account data to extract state and validator info
- Returns array sorted by lamports descending

### Imports

Use from `@solana/web3.js`:
```ts
import { StakeProgram, Authorized, Lockup, LAMPORTS_PER_SOL, ... } from "@solana/web3.js";
```

`StakeProgram` has static methods: `createAccount`, `initialize`, `delegate`, `deactivate`, `withdraw`.

### Export

**`src/actions/index.ts`** — add:
```ts
export { stakeSOL, unstakeSOL, getStakeAccounts } from "./stake.js";
export type { StakeSolParams, StakeSolResult, StakeAccountInfo } from "./stake.js";
```

**`src/agent.ts`** — add three methods:
```ts
stakeSOL(voteAccount: PublicKey | string, amount: number, opts?: BuildAndSendOptions): Promise<StakeSolResult>
unstakeSOL(stakeAccount: PublicKey | string, opts?: BuildAndSendOptions): Promise<string>
getStakeAccounts(): Promise<StakeAccountInfo[]>
```

**`src/index.ts`** — export the new types and functions.

### LLM actions — `src/solana-agent-kit/actions.ts`

Add three actions following the existing pattern (Zod schema, similes, examples, handler):
- `stake_sol` — stakes SOL to a validator
- `unstake_sol` — deactivates a stake account
- `get_stake_accounts` — lists stake accounts

Add them to `allActions`.

## Verification

1. `npm run build` passes with zero errors
2. `stakeSOL`, `unstakeSOL`, `getStakeAccounts` exported from main index
3. `SolanaAgent` has all three methods
4. Three new LLM actions in `allActions` array in `solana-agent-kit/actions.ts`
5. No new npm dependencies
