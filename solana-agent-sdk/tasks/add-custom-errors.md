# Feature: Custom error classes

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

## What to Build

The SDK currently throws generic `Error` everywhere. Consumers can't programmatically distinguish "user rejected" from "insufficient funds" from "RPC error". Add custom error classes so consumers can write:

```ts
try {
  await agent.swap(...);
} catch (err) {
  if (err instanceof TransactionRejectedError) showRejectedToast();
  if (err instanceof InsufficientFundsError) showFundsError(err.required, err.available);
  if (err instanceof SwapError) showSwapError(err.quote);
}
```

## Implementation

### `src/errors.ts`

Create this file with the following error classes:

```ts
/** Base class for all @three-ws/solana-agent errors */
export class SolanaAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Thrown when a transaction is rejected by the user (browser wallet) or timed out waiting for approval */
export class TransactionRejectedError extends SolanaAgentError {
  constructor(public readonly reason: string = "User rejected") {
    super(`Transaction rejected: ${reason}`);
  }
}

/** Thrown when a wallet is not connected (WalletAdapterProvider with null publicKey) */
export class WalletNotConnectedError extends SolanaAgentError {
  constructor() {
    super("Wallet is not connected");
  }
}

/** Thrown when a wallet adapter does not support a required operation */
export class WalletCapabilityError extends SolanaAgentError {
  constructor(public readonly capability: string) {
    super(`Wallet does not support: ${capability}`);
  }
}

/** Thrown when a sender has no token account for the given mint */
export class MissingTokenAccountError extends SolanaAgentError {
  constructor(public readonly mint: string, public readonly owner: string) {
    super(`No token account for mint ${mint} owned by ${owner}`);
  }
}

/** Thrown when a Jupiter swap quote or swap request fails */
export class SwapError extends SolanaAgentError {
  constructor(
    message: string,
    public readonly inputMint?: string,
    public readonly outputMint?: string,
  ) {
    super(message);
  }
}

/** Thrown when transaction simulation fails before submission */
export class SimulationError extends SolanaAgentError {
  constructor(public readonly simulationError: unknown) {
    super(`Transaction simulation failed: ${JSON.stringify(simulationError)}`);
  }
}

/** Thrown when a transaction is not confirmed within the timeout period */
export class ConfirmationTimeoutError extends SolanaAgentError {
  constructor(public readonly signature: string, public readonly timeoutMs: number) {
    super(`Transaction ${signature} not confirmed within ${timeoutMs}ms`);
  }
}
```

### Update existing code to use custom errors

Update these locations to throw custom errors instead of generic `Error`:

**`src/wallet/browser-server.ts`:**
- Timeout: `throw new TransactionRejectedError("Timed out waiting for user approval")` (import `TransactionRejectedError`)
- User rejected: `throw new TransactionRejectedError("User rejected")`

**`src/actions/transfer-spl.ts`** (after fix-sender-ata-missing.md is applied, or add it now):
- No sender ATA: `throw new MissingTokenAccountError(mint.toBase58(), wallet.publicKey.toBase58())`

**`src/tx/fees.ts`** (after fix-cu-fallback.md is applied, or add it now):
- Simulation error: `throw new SimulationError(sim.value.err)`

**`src/actions/swap.ts`:**
- Jupiter quote fail: `throw new SwapError(\`Jupiter quote failed: ${await res.text()}\`, inputMint, outputMint)`
- Jupiter swap fail: `throw new SwapError(\`Jupiter swap failed: ${await res.text()}\`, inputMint, outputMint)`

### Export

**`src/index.ts`** — add:
```ts
export {
  SolanaAgentError,
  TransactionRejectedError,
  WalletNotConnectedError,
  WalletCapabilityError,
  MissingTokenAccountError,
  SwapError,
  SimulationError,
  ConfirmationTimeoutError,
} from "./errors.js";
```

## Verification

1. `npm run build` passes with zero errors
2. All error classes are exported from the main package entry point
3. `new TransactionRejectedError() instanceof SolanaAgentError` is `true`
4. `new TransactionRejectedError() instanceof Error` is `true`
5. Error `name` property matches the class name (not "Error")
6. At minimum `browser-server.ts` uses `TransactionRejectedError` instead of generic `Error`
