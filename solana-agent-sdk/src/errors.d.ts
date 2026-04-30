/** Base class for all @three-ws/solana-agent errors */
export declare class SolanaAgentError extends Error {
    constructor(message: string);
}
/** Thrown when a transaction is rejected by the user (browser wallet) or timed out waiting for approval */
export declare class TransactionRejectedError extends SolanaAgentError {
    readonly reason: string;
    constructor(reason?: string);
}
/** Thrown when a wallet is not connected (WalletAdapterProvider with null publicKey) */
export declare class WalletNotConnectedError extends SolanaAgentError {
    constructor();
}
/** Thrown when a wallet adapter does not support a required operation */
export declare class WalletCapabilityError extends SolanaAgentError {
    readonly capability: string;
    constructor(capability: string);
}
/** Thrown when a sender has no token account for the given mint */
export declare class MissingTokenAccountError extends SolanaAgentError {
    readonly mint: string;
    readonly owner: string;
    constructor(mint: string, owner: string);
}
/** Thrown when a Jupiter swap quote or swap request fails */
export declare class SwapError extends SolanaAgentError {
    readonly inputMint?: string | undefined;
    readonly outputMint?: string | undefined;
    constructor(message: string, inputMint?: string | undefined, outputMint?: string | undefined);
}
/** Thrown when transaction simulation fails before submission */
export declare class SimulationError extends SolanaAgentError {
    readonly simulationError: unknown;
    constructor(simulationError: unknown);
}
/** Thrown when a transaction is not confirmed within the timeout period */
export declare class ConfirmationTimeoutError extends SolanaAgentError {
    readonly signature: string;
    readonly timeoutMs: number;
    constructor(signature: string, timeoutMs: number);
}
//# sourceMappingURL=errors.d.ts.map