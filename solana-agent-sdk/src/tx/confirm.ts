import {
  TransactionExpiredBlockheightExceededError,
  type Connection,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { ConfirmationTimeoutError, TransactionFailedError } from "../errors.js";

export type ConfirmCommitment = "processed" | "confirmed" | "finalized";

export interface ConfirmOptions {
  /** Commitment the signature must reach (default "confirmed"). */
  commitment?: ConfirmCommitment;
  /** Give up after this many milliseconds (default 90 000). */
  timeoutMs?: number;
  /**
   * Last block height at which the transaction's blockhash is valid. When set,
   * confirmation stops as soon as the chain passes it with the signature still
   * unseen, and throws web3.js's `TransactionExpiredBlockheightExceededError`
   * ("block height exceeded"), which buildAndSend treats as a cue to rebuild
   * with a fresh blockhash.
   */
  lastValidBlockHeight?: number;
  /** Delay between status polls (default 500ms). */
  pollIntervalMs?: number;
}

export const DEFAULT_CONFIRM_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

const RANK: Record<ConfirmCommitment, number> = { processed: 0, confirmed: 1, finalized: 2 };

/** The expiry height a legacy Transaction carries; versioned transactions carry none. */
export function lastValidBlockHeightOf(tx: Transaction | VersionedTransaction): number | undefined {
  return (tx as { lastValidBlockHeight?: number }).lastValidBlockHeight;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Status = {
  err: unknown;
  confirmations?: number | null;
  confirmationStatus?: ConfirmCommitment;
} | null;

async function statusOf(connection: Connection, signature: string): Promise<Status> {
  const { value } = await connection.getSignatureStatuses([signature]);
  return (value[0] ?? null) as Status;
}

/** Older RPC nodes omit confirmationStatus; `confirmations: null` there means rooted (finalized). */
function reached(status: NonNullable<Status>, commitment: ConfirmCommitment): boolean {
  const level = status.confirmationStatus ?? (status.confirmations === null ? "finalized" : "processed");
  return RANK[level] >= RANK[commitment];
}

/**
 * Wait until `signature` reaches `commitment`, polling getSignatureStatuses.
 *
 * Unlike `connection.confirmTransaction`, this never resolves for a transaction
 * that landed but failed: an on-chain error throws {@link TransactionFailedError}.
 *
 * @throws TransactionFailedError when the transaction executed with an error.
 * @throws TransactionExpiredBlockheightExceededError when `lastValidBlockHeight` passed first.
 * @throws ConfirmationTimeoutError when `timeoutMs` elapses first.
 */
export async function confirmSignature(
  connection: Connection,
  signature: string,
  opts: ConfirmOptions = {},
): Promise<void> {
  const commitment = opts.commitment ?? "confirmed";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let watchHeight = opts.lastValidBlockHeight !== undefined;

  for (;;) {
    let status = await statusOf(connection, signature);
    if (status?.err) throw new TransactionFailedError(signature, status.err);
    if (status && reached(status, commitment)) return;

    if (watchHeight && status === null) {
      const height = await connection.getBlockHeight(commitment);
      if (height > opts.lastValidBlockHeight!) {
        // It may have landed in the final valid block between the two reads.
        status = await statusOf(connection, signature);
        if (status === null) throw new TransactionExpiredBlockheightExceededError(signature);
        if (status.err) throw new TransactionFailedError(signature, status.err);
        if (reached(status, commitment)) return;
      }
    }
    // Once it has been seen, it can no longer expire; only commitment remains.
    if (status !== null) watchHeight = false;

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ConfirmationTimeoutError(signature, timeoutMs);
    await sleep(Math.min(pollIntervalMs, remaining));
  }
}
