/**
 * BrowserWalletClient — browser-side half of the wallet bridge.
 *
 * Polls the server for pending transactions, signs them with the provided
 * signer (Phantom, Solflare, or any Wallet Adapter), and submits them back.
 *
 * Works in any browser environment — no Node.js APIs required.
 *
 * Usage:
 *   const client = new BrowserWalletClient("/api/wallet", async (tx) => {
 *     return wallet.signTransaction(tx); // wallet adapter signTransaction
 *   });
 *   client.start();
 */
import { Transaction, VersionedTransaction } from "@solana/web3.js";

export type SignerFn = (
  tx: Transaction | VersionedTransaction,
) => Promise<Transaction | VersionedTransaction>;

export interface PendingTx {
  id: string;
  transaction: string;
  versioned: boolean;
  createdAt: number;
}

export class BrowserWalletClient {
  private readonly baseUrl: string;
  private readonly signer: SignerFn;
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = new Set<string>();

  constructor(baseUrl: string, signer: SignerFn) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.signer = signer;
  }

  start(intervalMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    let pending: PendingTx[];
    try {
      const res = await fetch(`${this.baseUrl}/pending`);
      if (!res.ok) return;
      const data = (await res.json()) as { pending: PendingTx[] };
      pending = data.pending;
    } catch {
      return;
    }

    for (const item of pending) {
      if (this.processing.has(item.id)) continue;
      this.processing.add(item.id);
      void this.handle(item).finally(() => this.processing.delete(item.id));
    }
  }

  private async handle(item: PendingTx): Promise<void> {
    const buf = base64ToUint8Array(item.transaction);
    const tx = item.versioned
      ? VersionedTransaction.deserialize(buf)
      : Transaction.from(buf);

    try {
      const signed = await this.signer(tx);
      const serialized = uint8ArrayToBase64(signed.serialize());
      await fetch(`${this.baseUrl}/sign/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedTransaction: serialized }),
      });
    } catch {
      await fetch(`${this.baseUrl}/reject/${item.id}`, { method: "POST" });
    }
  }
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}
