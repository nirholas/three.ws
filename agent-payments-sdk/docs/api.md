# API Reference — @pump-fun/agent-payments-sdk

Program ID: `AgenTMiC2hvxGebTsgmsD4HHBa8WEcqGFf87iwRRxLo7`

---

## Classes

### `PumpAgentOffline`

Instruction builder. No RPC connection required — all methods return a `TransactionInstruction` you include in your own transaction.

```ts
import { PumpAgentOffline } from "@pump-fun/agent-payments-sdk";
import { PublicKey } from "@solana/web3.js";

const agent = new PumpAgentOffline(mintPubkey);
// or
const agent = PumpAgentOffline.load(mintPubkey, connection);
```

| Method | Returns | Description |
|---|---|---|
| `create(params)` | `Promise<TransactionInstruction>` | Register a new agent (`agentInitialize`) |
| `withdraw(params)` | `Promise<TransactionInstruction>` | Withdraw from the withdraw vault |
| `updateBuybackBps(params, options)` | `Promise<TransactionInstruction>` | Update buyback basis points |
| `acceptPayment(params)` | `Promise<TransactionInstruction>` | Accept a payment (full params) |
| `acceptPaymentSimple(params)` | `Promise<TransactionInstruction[]>` | Accept payment + compute budget instructions |
| `buildAcceptPaymentTransaction(params)` | `Promise<Transaction>` | Build a ready-to-sign transaction |
| `distributePayments(params)` | `Promise<TransactionInstruction[]>` | Split vault to buyback + withdraw |
| `buybackTrigger(params)` | `Promise<TransactionInstruction>` | Trigger a buyback swap + burn |
| `updateAuthority(params)` | `Promise<TransactionInstruction>` | Transfer agent authority |
| `extendAccount(params)` | `Promise<TransactionInstruction>` | Extend account size |
| `closeAccount(params)` | `Promise<TransactionInstruction>` | Close an account |

**Static constants:**
- `DEFAULT_COMPUTE_UNIT_LIMIT_FOR_AGENT_PAYMENTS = 100_000`
- `DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS = 1_000`

---

### `PumpAgent`

Extends `PumpAgentOffline` with RPC calls for account fetching, balance queries, payment history, and invoice validation.

```ts
import { PumpAgent } from "@pump-fun/agent-payments-sdk";
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const agent = new PumpAgent(mintPubkey, "mainnet", connection);
```

**Constructor:** `new PumpAgent(mint, environment?, connection?)`
- `environment`: `"mainnet"` | `"devnet"` (default: `"mainnet"`)

Inherits all `PumpAgentOffline` methods, plus:

| Method | Returns | Description |
|---|---|---|
| `getBalances(currencyMint, tokenProgram?)` | `Promise<AgentBalances>` | Fetch all three vault balances |
| `updateBuybackBps(params)` | `Promise<TransactionInstruction>` | Auto-fetches supported currencies from GlobalConfig |
| `getAgentConfig()` | `Promise<TokenAgentPayments>` | Fetch the on-chain agent config |
| `getGlobalConfig()` | `Promise<GlobalConfig>` | Fetch the protocol GlobalConfig |
| `getPaymentStats(currencyMint)` | `Promise<TokenAgentPaymentInCurrency>` | Fetch per-currency accounting |
| `getSupportedCurrencies()` | `Promise<PublicKey[]>` | List supported currency mints |
| `isInitialized()` | `Promise<boolean>` | Check if the agent account exists |
| `getPaymentHistory(limit?)` | `Promise<AgentAcceptPaymentEvent[]>` | Fetch recent payment events (default limit: 50) |
| `getEventHistory(limit?)` | `Promise<ParsedAgentEvent[]>` | Fetch all recent events (default limit: 50) |
| `validateInvoicePayment(params)` | `Promise<boolean>` | Validate a payment was made (API then RPC fallback) |

---

## Parameter Types

### `CreateParams`
```ts
interface CreateParams {
  authority: PublicKey;      // bonding-curve creator for this mint
  mint: PublicKey;           // token mint this agent manages
  agentAuthority: PublicKey; // agent authority (for withdraw / update)
  buybackBps: number;        // 0–10 000 (basis points)
}
```

### `AcceptPaymentParams`
```ts
interface AcceptPaymentParams {
  user: PublicKey;
  userTokenAccount: PublicKey;
  currencyMint: PublicKey;
  amount: BN;
  memo: BN;
  startTime: BN;
  endTime: BN;
  tokenProgram?: PublicKey;  // defaults to TOKEN_PROGRAM_ID
}
```

### `AcceptPaymentSimpleParams`
Same as above but `amount / memo / startTime / endTime` accept `bigint | number | string`, plus:
```ts
computeUnitLimit?: number;  // default 130_000
computeUnitPrice?: number;  // micro lamports per CU, default 1_000
```

### `BuildAcceptPaymentParams`
```ts
interface BuildAcceptPaymentParams {
  user: PublicKey;
  currencyMint: PublicKey;
  amount: bigint | number | string;
  memo: bigint | number | string;
  startTime: bigint | number | string;
  endTime: bigint | number | string;
  tokenProgram?: PublicKey;
  computeUnitLimit?: number;   // default 100_000
  computeUnitPrice?: number;
}
```

### `DistributePaymentsParams`
```ts
interface DistributePaymentsParams {
  user: PublicKey;
  currencyMint: PublicKey;
  tokenProgram?: PublicKey;
  includeTransferExtraLamportsForNative?: boolean; // default false
}
```

### `BuybackTriggerParams`
```ts
interface BuybackTriggerParams {
  globalBuybackAuthority: PublicKey;
  currencyMint: PublicKey;
  swapProgramToInvoke: PublicKey;
  swapInstructionData: Buffer;        // empty Buffer = skip swap, just burn
  remainingAccounts: AccountMeta[];
  tokenProgramCurrency?: PublicKey;
  tokenProgram?: PublicKey;
}
```

### `UpdateBuybackBpsParams`
```ts
interface UpdateBuybackBpsParams {
  authority: PublicKey;
  buybackBps: number; // 0–10 000
}
```

### `WithdrawParams`
```ts
interface WithdrawParams {
  authority: PublicKey;
  currencyMint: PublicKey;
  receiverAta: PublicKey;
  tokenProgram?: PublicKey;
}
```

### `UpdateAuthorityParams`
```ts
interface UpdateAuthorityParams {
  authority: PublicKey;
  newAuthority: PublicKey;
}
```

### `ExtendAccountParams` / `CloseAccountParams`
```ts
interface ExtendAccountParams { account: PublicKey; user: PublicKey; }
interface CloseAccountParams   { account: PublicKey; user: PublicKey; }
```

---

## Account Types

### `AgentBalances`
```ts
interface AgentBalances {
  paymentVault: VaultBalance;  // incoming payments land here
  buybackVault: VaultBalance;  // earmarked for buyback
  withdrawVault: VaultBalance; // earmarked for withdrawal
}

interface VaultBalance {
  address: PublicKey;
  balance: bigint;
}
```

### `GlobalConfig`
Fetched via `agent.getGlobalConfig()` or `OFFLINE_PUMP_PROGRAM.account.GlobalConfig.fetch(pda)`.
Fields: `protocolAuthority`, `buybackAuthority`, `supportedCurrenciesMint[]`.

### `TokenAgentPayments`
Fetched via `agent.getAgentConfig()`.
Fields: `authority`, `buybackBps`, `mint`, `tokenizedAgentSequence`.

### `TokenAgentPaymentInCurrency`
Fetched via `agent.getPaymentStats(currencyMint)`.
Fields: `totalPayments`, `totalBuyback`, `totalWithdraw`, `totalTokensBurned`.

---

## Program Helpers

```ts
import { getPumpProgram, getPumpProgramWithFallback, getOfflineProgram, getProgram } from "@pump-fun/agent-payments-sdk";
```

| Helper | Description |
|---|---|
| `getPumpProgram(connection)` | Create an Anchor `Program` with a live connection |
| `getPumpProgramWithFallback(connection?)` | Use connection if provided, else offline |
| `getOfflineProgram()` | Get the static offline program instance |
| `getProgram(connection)` | Convenience alias for `getPumpProgram` |
| `OFFLINE_PUMP_PROGRAM` | Pre-built offline program instance (no connection) |

---

## Constants

```ts
import {
  PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PUMP_AGENT_PAYMENTS_PROGRAM_ID,
  TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS,
} from "@pump-fun/agent-payments-sdk";
```

| Constant | Value |
|---|---|
| `PROGRAM_ID` | `AgenTMiC2hvxGebTsgmsD4HHBa8WEcqGFf87iwRRxLo7` |
| `PUMP_PROGRAM_ID` | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |
| `PUMP_AGENT_PAYMENTS_PROGRAM_ID` | same as `PROGRAM_ID` (convenience) |
| `TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS` | `1_412_880` (~0.00141 SOL) |

---

## Decoders

For raw account data (e.g. from `getAccountInfo`):

```ts
import {
  decodeGlobalConfig,
  decodeTokenAgentPaymentInCurrency,
  decodeTokenAgentPayments,
} from "@pump-fun/agent-payments-sdk";
```

Each decoder accepts a `Buffer` of raw account data and returns the typed struct.
