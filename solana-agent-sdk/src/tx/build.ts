import {
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { WalletProvider } from "../wallet/types.js";
import {
  estimateComputeUnits,
  estimatePriorityFee,
  computeUnitIx,
  priorityFeeIx,
} from "./fees.js";

export interface BuildAndSendOptions {
  /** microLamports per CU — omit to auto-estimate from recent fees */
  priorityFee?: number;
  /** Compute unit limit — omit to simulate and auto-set */
  cuLimit?: number;
  /** Max times to retry on blockhash expiry (default 3) */
  maxRetries?: number;
}

export async function buildAndSend(
  wallet: WalletProvider,
  connection: Connection,
  instructions: TransactionInstruction[],
  opts: BuildAndSendOptions = {},
): Promise<string> {
  const { maxRetries = 3 } = opts;

  const [fee, cuLimit] = await Promise.all([
    opts.priorityFee !== undefined
      ? Promise.resolve(opts.priorityFee)
      : estimatePriorityFee(connection),
    opts.cuLimit !== undefined
      ? Promise.resolve(opts.cuLimit)
      : estimateComputeUnits(connection, instructions, wallet.publicKey),
  ]);

  const budgetIxs: TransactionInstruction[] = [
    priorityFeeIx(fee),
    computeUnitIx(cuLimit),
  ];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    tx.add(...budgetIxs, ...instructions);

    try {
      return await wallet.signAndSendTransaction(tx, connection);
    } catch (err) {
      const isExpired =
        err instanceof Error &&
        (err.message.includes("Blockhash not found") ||
          err.message.includes("block height exceeded"));

      if (!isExpired || attempt === maxRetries - 1) throw err;

      const slot = await connection.getSlot();
      if (slot > lastValidBlockHeight) continue;
      throw err;
    }
  }

  throw new Error("buildAndSend: exhausted retries");
}
