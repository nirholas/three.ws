import { PublicKey, type Connection } from "@solana/web3.js";
import type { WalletProvider } from "../wallet/types.js";
import { type BuildAndSendOptions } from "../tx/build.js";
export interface TransferSplParams {
    mint: PublicKey | string;
    to: PublicKey | string;
    /** Amount in token base units (not human-readable) */
    amount: bigint;
    /** Optional symbol override for display (e.g. "USDC") */
    symbol?: string;
    memo?: string;
}
export declare function transferSpl(wallet: WalletProvider, connection: Connection, params: TransferSplParams, opts?: BuildAndSendOptions): Promise<string>;
//# sourceMappingURL=transfer-spl.d.ts.map