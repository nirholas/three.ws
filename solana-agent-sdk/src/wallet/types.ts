import type { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

export interface WalletProvider {
  readonly publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAndSendTransaction(tx: Transaction | VersionedTransaction, connection: Connection): Promise<string>;
}
