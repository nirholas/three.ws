import type { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { TxMetadata, MetaAwareWallet } from "./types.js";
import { WalletCapabilityError, WalletNotConnectedError } from "../errors.js";
import { confirmSignature, lastValidBlockHeightOf, type ConfirmOptions } from "../tx/confirm.js";

export interface WalletAdapterLike {
  publicKey: PublicKey | null;
  connected: boolean;
  signTransaction?<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  sendTransaction(tx: Transaction | VersionedTransaction, connection: Connection): Promise<string>;
}

/** Wraps a @solana/wallet-adapter-base adapter (Phantom, Solflare, Backpack, ...) as a WalletProvider. */
export class WalletAdapterProvider implements MetaAwareWallet {
  private _adapter: WalletAdapterLike;
  private _nextMeta: TxMetadata | null = null;

  constructor(adapter: WalletAdapterLike) {
    this._adapter = adapter;
  }

  /** @throws WalletNotConnectedError when the adapter has no public key. */
  get publicKey(): PublicKey {
    if (!this._adapter.publicKey) throw new WalletNotConnectedError();
    return this._adapter.publicKey;
  }

  /**
   * @throws WalletNotConnectedError when the adapter is disconnected.
   * @throws WalletCapabilityError("signTransaction") when the adapter cannot sign without sending.
   */
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    this.assertConnected();
    if (typeof this._adapter.signTransaction !== "function") throw new WalletCapabilityError("signTransaction");
    return this._adapter.signTransaction(tx);
  }

  /**
   * Hand the transaction to the adapter to sign and submit, then wait for it to
   * reach `confirm.commitment` (default "confirmed").
   *
   * @throws WalletNotConnectedError, WalletCapabilityError("sendTransaction"),
   *   TransactionFailedError, ConfirmationTimeoutError.
   */
  async signAndSendTransaction(
    tx: Transaction | VersionedTransaction,
    connection: Connection,
    confirm: ConfirmOptions = {},
  ): Promise<string> {
    this.assertConnected();
    if (typeof this._adapter.sendTransaction !== "function") throw new WalletCapabilityError("sendTransaction");
    const signature = await this._adapter.sendTransaction(tx, connection);
    await confirmSignature(connection, signature, {
      ...confirm,
      lastValidBlockHeight: confirm.lastValidBlockHeight ?? lastValidBlockHeightOf(tx),
    });
    return signature;
  }

  setNextMeta(meta: TxMetadata): void {
    this._nextMeta = meta;
  }

  getNextMeta(): TxMetadata | null {
    return this._nextMeta;
  }

  private assertConnected(): void {
    if (!this._adapter.publicKey) throw new WalletNotConnectedError();
  }
}
