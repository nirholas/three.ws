import { PublicKey, type Connection } from "@solana/web3.js";
import type { WalletProvider } from "../wallet/types.js";
import { type BuildAndSendOptions } from "../tx/build.js";
export interface GetOrCreateAtaParams {
    mint: PublicKey | string;
    owner?: PublicKey | string;
}
export interface GetOrCreateAtaResult {
    ata: PublicKey;
    /** Defined if a create transaction was sent; undefined if ATA already existed */
    signature?: string;
}
export declare function getOrCreateAta(wallet: WalletProvider, connection: Connection, params: GetOrCreateAtaParams, opts?: BuildAndSendOptions): Promise<GetOrCreateAtaResult>;
//# sourceMappingURL=ata.d.ts.map