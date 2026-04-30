import type { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
export interface WalletProvider {
    readonly publicKey: PublicKey;
    signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
    signAndSendTransaction(tx: Transaction | VersionedTransaction, connection: Connection): Promise<string>;
}
/** Human-readable description of what a transaction does — shown before the wallet prompt. */
export interface TxMetadata {
    /** Short label for the action: "Swap SOL → USDC", "Send 0.5 SOL" */
    label: string;
    /** Longer description for display in a confirmation card */
    description?: string;
    /** Category drives the confirmation UI icon/layout */
    kind: "transfer" | "swap" | "create" | "custom";
    /** Token/SOL being sent */
    amountIn?: {
        amount: string;
        symbol: string;
        uiAmount: string;
    };
    /** Token/SOL being received — set for swaps */
    amountOut?: {
        amount: string;
        symbol: string;
        uiAmount: string;
    };
    /** Recipient display string (shortened address or domain name) */
    recipient?: string;
}
/**
 * Optional extension interface for wallet providers that support metadata.
 * Browser wallet providers implement this so actions can attach rich context
 * to a pending transaction before it reaches the user's wallet.
 */
export interface MetaAwareWallet extends WalletProvider {
    setNextMeta(meta: TxMetadata): void;
}
export declare function isMetaAware(wallet: WalletProvider): wallet is MetaAwareWallet;
//# sourceMappingURL=types.d.ts.map