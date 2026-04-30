import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  type AddressLookupTableAccount,
  type Connection,
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

export interface BuildAndSendOptions {
  /** microLamports per CU — omit to auto-estimate from recent fees */
  priorityFee?: number;
  /** Compute unit limit — omit to simulate and auto-set */
  cuLimit?: number;
  /** Max times to retry on blockhash expiry (default 3) */
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
}

export async function buildAndSend(
  wallet: WalletProvider,
  connection: Connection,
  instructions: TransactionInstruction[],
  opts: BuildAndSendOptions = {},
): Promise<string> {
  const { maxRetries = 3 } = opts;

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

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    let tx: Transaction | VersionedTransaction;

    if (opts.lookupTables && opts.lookupTables.length > 0) {
      const msg = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: [...budgetIxs, ...allInstructions],
      }).compileToV0Message(opts.lookupTables);
      tx = new VersionedTransaction(msg);
    } else {
      const legacyTx = new Transaction();
      legacyTx.recentBlockhash = blockhash;
      legacyTx.lastValidBlockHeight = lastValidBlockHeight;
      legacyTx.feePayer = wallet.publicKey;
      legacyTx.add(...budgetIxs, ...allInstructions);
      tx = legacyTx;
    }

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

export async function fetchLookupTables(
  connection: Connection,
  addresses: string[],
): Promise<AddressLookupTableAccount[]> {
  return Promise.all(
    addresses.map(async (addr) => {
      const res = await connection.getAddressLookupTable(new PublicKey(addr));
      if (!res.value) throw new Error(`Lookup table not found: ${addr}`);
      return res.value;
    }),
  );
}
