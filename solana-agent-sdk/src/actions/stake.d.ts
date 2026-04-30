import { Connection, PublicKey } from "@solana/web3.js";
import { type WalletProvider } from "../wallet/types.js";
import { type BuildAndSendOptions } from "../tx/build.js";
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
export declare function stakeSOL(wallet: WalletProvider, connection: Connection, params: StakeSolParams, opts?: BuildAndSendOptions): Promise<StakeSolResult>;
export interface UnstakeSolParams {
    /** Stake account address to deactivate */
    stakeAccount: PublicKey | string;
}
/** Deactivate a stake account. SOL is withdrawable after ~1 epoch (2-3 days). */
export declare function unstakeSOL(wallet: WalletProvider, connection: Connection, params: UnstakeSolParams, opts?: BuildAndSendOptions): Promise<string>;
export interface StakeAccountInfo {
    address: string;
    lamports: number;
    state: "initialized" | "delegated" | "deactivating" | "inactive";
    voteAccount?: string;
    activationEpoch?: number;
    deactivationEpoch?: number;
}
export declare function getStakeAccounts(connection: Connection, owner: PublicKey): Promise<StakeAccountInfo[]>;
//# sourceMappingURL=stake.d.ts.map