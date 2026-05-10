import {
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

/** Microlamports */
export const DEFAULT_PRIORITY_FLOOR = 100_000;
/** Microlamports — upper bound when RPC returns very high estimates */
export const MAX_PRIORITY_FEE = 5_000_000;

/**
 * @param {import("@solana/web3.js").Connection} connection
 * @param {import("@solana/web3.js").VersionedTransaction} tx
 * @param {string} [priorityLevel]
 * @returns {Promise<number>}
 */
export async function getPriorityFeeEstimate(
  connection,
  tx,
  priorityLevel = "Medium",
) {
  try {
    const res = await fetch(connection.rpcEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "pump-skill-priority",
        method: "getPriorityFeeEstimate",
        params: [
          {
            transaction: Buffer.from(tx.serialize()).toString("base64"),
            options: { priorityLevel, transactionEncoding: "base64" },
          },
        ],
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const est = data?.result?.priorityFeeEstimate ?? 0;
    return Math.floor(
      Math.min(
        Math.max(Number(est) || 0, DEFAULT_PRIORITY_FLOOR),
        MAX_PRIORITY_FEE,
      ),
    );
  } catch {
    return DEFAULT_PRIORITY_FLOOR;
  }
}

/**
 * @param {number} units
 * @param {number} microLamports
 * @returns {import("@solana/web3.js").TransactionInstruction[]}
 */
export function computeBudgetInstructions(units, microLamports) {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ];
}

/**
 * Draft tx for priority fee RPC (matches pump-solana pattern: high CU + minimal price).
 * @param {import("@solana/web3.js").PublicKey} payerKey
 * @param {import("@solana/web3.js").TransactionInstruction[]} sdkInstructions
 * @returns {import("@solana/web3.js").VersionedTransaction}
 */
export function buildDraftTxForFeeEstimate(payerKey, sdkInstructions) {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [
        ...computeBudgetInstructions(1_400_000, 1),
        ...sdkInstructions,
      ],
    }).compileToV0Message(),
  );
}
