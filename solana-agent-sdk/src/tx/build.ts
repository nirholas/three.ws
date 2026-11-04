import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  type AddressLookupTableAccount,
  type Connection,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";
import { isMetaAware, type WalletProvider, type TxMetadata } from "../wallet/types.js";
import {
  estimateComputeUnits,
  estimatePriorityFee,
  computeUnitIx,
  priorityFeeIx,
} from "./fees.js";
import { memoInstruction } from "../utils/memo.js";
import { LookupTableNotFoundError, RetriesExhaustedError } from "../errors.js";
import type { ConfirmCommitment, ConfirmOptions } from "./confirm.js";

export interface BuildAndSendOptions {
  /** microLamports per CU; omit to auto-estimate from recent fees */
  priorityFee?: number;
  /** Compute unit limit; omit to simulate and auto-set */
  cuLimit?: number;
  /**
   * Total send attempts when the blockhash expires before the transaction
   * lands (default 3; values below 1 mean a single attempt). Each attempt
   * rebuilds with a fresh blockhash.
   */
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
  /**
   * Additional keypairs that must sign, such as a freshly generated stake or
   * mint account. They partially sign every attempt before the wallet signs.
   */
  signers?: Signer[];
  /** Commitment to wait for before resolving (default "confirmed"). */
  commitment?: ConfirmCommitment;
  /** Confirmation timeout per attempt in milliseconds (default 90 000). */
  confirmTimeoutMs?: number;
}

function isBlockhashExpiry(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes("Blockhash not found") || err.message.includes("block height exceeded"))
  );
}

/**
 * Build, sign, send, and confirm a transaction from instructions.
 *
 * Prepends compute-budget instructions (estimated unless given), appends the
 * memo, and rebuilds with a fresh blockhash when the previous one expired
 * before the transaction landed.
 *
 * @throws RetriesExhaustedError when every attempt's blockhash expired.
 * @throws SimulationError when compute-unit estimation fails simulation.
 * @throws TransactionFailedError, ConfirmationTimeoutError, or any wallet error
 *   (for example TransactionRejectedError) unchanged and without retrying.
 */
export async function buildAndSend(
  wallet: WalletProvider,
  connection: Connection,
  instructions: TransactionInstruction[],
  opts: BuildAndSendOptions = {},
): Promise<string> {
  const attempts = Math.max(1, Math.floor(opts.maxRetries ?? 3));

  if (opts.meta && isMetaAware(wallet)) {
    wallet.setNextMeta(opts.meta);
  }

  const allInstructions = opts.memo
    ? [...instructions, memoInstruction(opts.memo, [wallet.publicKey])]
    : instructions;

  const [fee, cuLimit] = await Promise.all([
    opts.priorityFee !== undefined
      ? Promise.resolve(opts.priorityFee)
      : estimatePriorityFee(connection),
    opts.cuLimit !== undefined
      ? Promise.resolve(opts.cuLimit)
      : estimateComputeUnits(connection, allInstructions, wallet.publicKey),
  ]);

  const budgetIxs: TransactionInstruction[] = [
    priorityFeeIx(fee),
    computeUnitIx(cuLimit),
  ];
  const signers = opts.signers ?? [];

  let lastBlockhash = "";
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    lastBlockhash = blockhash;

    let tx: Transaction | VersionedTransaction;

    if (opts.lookupTables && opts.lookupTables.length > 0) {
      const msg = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: [...budgetIxs, ...allInstructions],
      }).compileToV0Message(opts.lookupTables);
      const versioned = new VersionedTransaction(msg);
      if (signers.length) versioned.sign(signers);
      tx = versioned;
    } else {
      const legacyTx = new Transaction();
      legacyTx.recentBlockhash = blockhash;
      legacyTx.lastValidBlockHeight = lastValidBlockHeight;
      legacyTx.feePayer = wallet.publicKey;
      legacyTx.add(...budgetIxs, ...allInstructions);
      if (signers.length) legacyTx.partialSign(...signers);
      tx = legacyTx;
    }

    const confirm: ConfirmOptions = { lastValidBlockHeight };
    if (opts.commitment !== undefined) confirm.commitment = opts.commitment;
    if (opts.confirmTimeoutMs !== undefined) confirm.timeoutMs = opts.confirmTimeoutMs;

    try {
      return await wallet.signAndSendTransaction(tx, connection, confirm);
    } catch (err) {
      if (!isBlockhashExpiry(err)) throw err;
      lastError = err;
      if (attempt === attempts) break;

      // A lagging RPC can report "Blockhash not found" for a blockhash that is
      // still valid. Resending then could land the transaction twice, so only
      // rebuild once the chain is provably past the blockhash's last valid height.
      const blockHeight = await connection.getBlockHeight();
      if (blockHeight <= lastValidBlockHeight) throw err;
    }
  }

  throw new RetriesExhaustedError(attempts, lastBlockhash, lastError);
}

/** @throws LookupTableNotFoundError naming the first address that has no lookup table account. */
export async function fetchLookupTables(
  connection: Connection,
  addresses: string[],
): Promise<AddressLookupTableAccount[]> {
  return Promise.all(
    addresses.map(async (addr) => {
      const res = await connection.getAddressLookupTable(new PublicKey(addr));
      if (!res.value) throw new LookupTableNotFoundError(addr);
      return res.value;
    }),
  );
}
