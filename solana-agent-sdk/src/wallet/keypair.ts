import {
  Keypair,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
  type Connection,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { WalletProvider } from "./types.js";

export class KeypairWalletProvider implements WalletProvider {
  private readonly keypair: Keypair;

  constructor(privateKey: string | Uint8Array | number[]) {
    if (typeof privateKey === "string") {
      this.keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    } else {
      this.keypair = Keypair.fromSecretKey(Uint8Array.from(privateKey));
    }
  }

  get publicKey() {
    return this.keypair.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof Transaction) {
      tx.sign(this.keypair);
    } else {
      tx.sign([this.keypair]);
    }
    return tx;
  }

  async signAndSendTransaction(tx: Transaction | VersionedTransaction, connection: Connection): Promise<string> {
    if (tx instanceof Transaction) {
      return sendAndConfirmTransaction(connection, tx, [this.keypair]);
    }
    tx.sign([this.keypair]);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  }
}
