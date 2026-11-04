import { Keypair, Transaction, VersionedTransaction, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import type { WalletProvider } from "./types.js";
import {
  confirmSignature,
  lastValidBlockHeightOf,
  type ConfirmCommitment,
  type ConfirmOptions,
} from "../tx/confirm.js";

export interface KeypairWalletOptions {
  /** Default commitment signAndSendTransaction waits for (default "confirmed"). */
  commitment?: ConfirmCommitment;
  /** Default confirmation timeout in milliseconds (default 90 000). */
  confirmTimeoutMs?: number;
}

/** A WalletProvider backed by an in-process keypair, for agents and scripts. */
export class KeypairWalletProvider implements WalletProvider {
  private readonly keypair: Keypair;
  private readonly defaults: KeypairWalletOptions;

  constructor(privateKey: string | Uint8Array | number[], opts: KeypairWalletOptions = {}) {
    if (typeof privateKey === "string") {
      this.keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    } else {
      this.keypair = Keypair.fromSecretKey(Uint8Array.from(privateKey));
    }
    this.defaults = opts;
  }

  get publicKey() {
    return this.keypair.publicKey;
  }

  /**
   * Add this wallet's signature. Signatures already on the transaction (a
   * co-signer such as a freshly generated stake or mint account) are kept.
   */
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof Transaction) {
      tx.partialSign(this.keypair);
    } else {
      tx.sign([this.keypair]);
    }
    return tx;
  }

  /**
   * Sign, submit with preflight, and wait for confirmation.
   *
   * @throws TransactionFailedError when the transaction landed with an error.
   * @throws ConfirmationTimeoutError when it did not reach the commitment in time.
   * @throws TransactionExpiredBlockheightExceededError ("block height exceeded")
   *   when the blockhash expired before it landed.
   */
  async signAndSendTransaction(
    tx: Transaction | VersionedTransaction,
    connection: Connection,
    confirm: ConfirmOptions = {},
  ): Promise<string> {
    await this.signTransaction(tx);
    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await confirmSignature(connection, signature, {
      commitment: this.defaults.commitment,
      timeoutMs: this.defaults.confirmTimeoutMs,
      ...definedOnly(confirm),
      lastValidBlockHeight: confirm.lastValidBlockHeight ?? lastValidBlockHeightOf(tx),
    });
    return signature;
  }
}

/** Drop undefined keys so a caller's `{ timeoutMs: undefined }` does not erase a provider default. */
function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
