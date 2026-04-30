import { PublicKey, type Connection } from "@solana/web3.js";
import type { WalletProvider } from "../wallet/types.js";
import { type BuildAndSendOptions } from "../tx/build.js";
export interface TransferSolParams {
    to: PublicKey | string;
    /** Amount in SOL (not lamports) */
    amount: number;
    memo?: string;
}
export declare function transferSol(wallet: WalletProvider, connection: Connection, params: TransferSolParams, opts?: BuildAndSendOptions): Promise<string>;
//# sourceMappingURL=transfer-sol.d.ts.map