import { TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  buildDraftTxForFeeEstimate,
  computeBudgetInstructions,
  getPriorityFeeEstimate,
} from "./compute.mjs";
import { jitoTipInstruction } from "./jito.mjs";

/**
 * @param {object} opts
 * @param {import("@solana/web3.js").Connection} opts.connection
 * @param {import("@solana/web3.js").PublicKey} opts.payerKey
 * @param {import("@solana/web3.js").TransactionInstruction[]} opts.sdkInstructions
 * @param {number} opts.computeUnits
 * @param {number | null | undefined} opts.priorityFeeMicroLamports — if null/undefined, estimate via RPC
 * @param {import("@solana/web3.js").Keypair[]} [opts.extraSigners]
 * @param {import("@solana/web3.js").AddressLookupTableAccount[]} [opts.addressLookupTableAccounts]
 * @param {boolean} [opts.frontRunnerProtection] — when true, adds a Jito tip and the tx should only be sent to Jito
 * @param {number} [opts.tipSol] — Jito tip in SOL (default 0.0001); only used when frontRunnerProtection is true
 * @returns {Promise<import("@solana/web3.js").VersionedTransaction>}
 */
export async function buildAndPartialSignTx({
  connection,
  payerKey,
  sdkInstructions,
  computeUnits,
  priorityFeeMicroLamports,
  extraSigners = [],
  addressLookupTableAccounts = [],
  frontRunnerProtection = false,
  tipSol,
}) {
  let microLamports = priorityFeeMicroLamports;
  if (microLamports == null) {
    const draft = buildDraftTxForFeeEstimate(payerKey, sdkInstructions);
    microLamports = await getPriorityFeeEstimate(connection, draft);
  }

  const allInstructions = [
    ...computeBudgetInstructions(computeUnits, microLamports),
    ...(frontRunnerProtection ? [jitoTipInstruction(payerKey, tipSol)] : []),
    ...sdkInstructions,
  ];

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message(addressLookupTableAccounts),
  );

  if (extraSigners.length > 0) {
    tx.sign(extraSigners);
  }

  return tx;
}

/**
 * @param {import("@solana/web3.js").VersionedTransaction} tx
 * @returns {string}
 */
export function transactionToBase64(tx) {
  return Buffer.from(tx.serialize()).toString("base64");
}
