import { type AddressLookupTableAccount, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { type WalletProvider, type TxMetadata } from "../wallet/types.js";
export interface BuildAndSendOptions {
    /** microLamports per CU — omit to auto-estimate from recent fees */
    priorityFee?: number;
    /** Compute unit limit — omit to simulate and auto-set */
    cuLimit?: number;
    /** Max times to retry on blockhash expiry (default 3) */
    maxRetries?: number;
    /**
     * Human-readable description attached to the pending tx.
     * BrowserWalletProvider uses this to show a confirmation card
     * before the wallet prompt appears.
     */
    meta?: TxMetadata;
    /**
     * Optional UTF-8 memo string attached to the transaction.
     * Visible in Solana Explorer and on-chain indexers.
     */
    memo?: string;
    /**
     * Address Lookup Tables to include. When provided, builds a VersionedTransaction
     * (v0 message) instead of a legacy Transaction. Required for transactions that
     * reference more than 32 accounts.
     */
    lookupTables?: AddressLookupTableAccount[];
}
export declare function buildAndSend(wallet: WalletProvider, connection: Connection, instructions: TransactionInstruction[], opts?: BuildAndSendOptions): Promise<string>;
export declare function fetchLookupTables(connection: Connection, addresses: string[]): Promise<AddressLookupTableAccount[]>;
//# sourceMappingURL=build.d.ts.map