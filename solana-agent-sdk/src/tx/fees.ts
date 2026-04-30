import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

export async function estimatePriorityFee(connection: Connection): Promise<number> {
  const fees = await connection.getRecentPrioritizationFees();
  if (fees.length === 0) return 1_000;
  const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.75)] ?? 1_000;
}

export async function estimateComputeUnits(
  connection: Connection,
  instructions: TransactionInstruction[],
  payer: PublicKey,
): Promise<number> {
  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const sim = await connection.simulateTransaction(
    new VersionedTransaction(msg),
    { sigVerify: false },
  );

  const units = sim.value.unitsConsumed;
  if (!units) return 200_000;
  return Math.ceil(units * 1.1);
}

export function priorityFeeIx(microLamports: number): TransactionInstruction {
  return ComputeBudgetProgram.setComputeUnitPrice({ microLamports });
}

export function computeUnitIx(units: number): TransactionInstruction {
  return ComputeBudgetProgram.setComputeUnitLimit({ units });
}
