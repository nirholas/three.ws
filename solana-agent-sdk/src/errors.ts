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
