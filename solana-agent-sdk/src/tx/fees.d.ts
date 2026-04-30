import { PublicKey, type Connection, type TransactionInstruction } from "@solana/web3.js";
export declare function estimatePriorityFee(connection: Connection): Promise<number>;
export declare function estimateComputeUnits(connection: Connection, instructions: TransactionInstruction[], payer: PublicKey): Promise<number>;
export declare function priorityFeeIx(microLamports: number): TransactionInstruction;
export declare function computeUnitIx(units: number): TransactionInstruction;
//# sourceMappingURL=fees.d.ts.map