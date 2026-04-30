import type { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { TxMetadata, MetaAwareWallet } from "./types.js";

export interface WalletAdapterLike {
  publicKey: PublicKey | null;
  connected: boolean;
  signTransaction?<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  sendTransaction(tx: Transaction | VersionedTransaction, connection: Connection): Promise<string>;
}

export class WalletAdapterProvider implements MetaAwareWallet {
  private _adapter: WalletAdapterLike;
  private _nextMeta: TxMetadata | null = null;

  constructor(adapter: WalletAdapterLike) {
    this._adapter = adapter;
  }

  get publicKey(): PublicKey {
    if (!this._adapter.publicKey) throw new Error("Wallet not connected");
    return this._adapter.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (!this._adapter.signTransaction) throw new Error("Wallet does not support signTransaction");
    return this._adapter.signTransaction(tx);
  }

  async signAndSendTransaction(tx: Transaction | VersionedTransaction, connection: Connection): Promise<string> {
    return this._adapter.sendTransaction(tx, connection);
  }

  setNextMeta(meta: TxMetadata): void {
    this._nextMeta = meta;
  }

  getNextMeta(): TxMetadata | null {
    return this._nextMeta;
  }
}
