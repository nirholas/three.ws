/**
 * BrowserWalletProvider — server-side half of the browser wallet bridge.
 *
 * The agent calls signAndSendTransaction() as normal. Internally this creates a
 * pending request that the browser can pick up, sign with Phantom/Solflare, and
 * submit back. The Promise resolves once the browser returns the signed tx.
 *
 * Mount createHandler() on any HTTP path (e.g. POST /api/wallet/sign/:id).
 * Point BrowserWalletClient (browser-client.ts) at the same base URL.
 */
import { EventEmitter } from "events";
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import type { WalletProvider } from "./types.js";

export interface PendingTx {
  id: string;
  transaction: string;
  versioned: boolean;
  createdAt: number;
}

export interface BrowserWalletOptions {
  publicKey: PublicKey | string;
  sessionId?: string;
  timeoutMs?: number;
}

export class BrowserWalletProvider implements WalletProvider {
  readonly publicKey: PublicKey;
  readonly sessionId: string;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingTx>();
  private readonly emitter = new EventEmitter();

  constructor(opts: BrowserWalletOptions) {
    this.publicKey =
      typeof opts.publicKey === "string"
        ? new PublicKey(opts.publicKey)
        : opts.publicKey;
    this.sessionId = opts.sessionId ?? crypto.randomUUID();
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const id = crypto.randomUUID();
    const versioned = !(tx instanceof Transaction);
    const serialized = Buffer.from(
      tx instanceof Transaction
        ? tx.serialize({ requireAllSignatures: false })
        : tx.serialize(),
    ).toString("base64");

    this.pending.set(id, { id, transaction: serialized, versioned, createdAt: Date.now() });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Transaction ${id} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.emitter.once(`signed:${id}`, (signedBase64: string) => {
        clearTimeout(timer);
        this.pending.delete(id);
        const buf = Buffer.from(signedBase64, "base64");
        const signed = versioned
          ? VersionedTransaction.deserialize(buf)
          : Transaction.from(buf);
        resolve(signed as T);
      });

      this.emitter.once(`rejected:${id}`, () => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`Transaction ${id} rejected by user`));
      });
    });
  }

  async signAndSendTransaction(tx: Transaction | VersionedTransaction, connection: Connection): Promise<string> {
    const signed = await this.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  }

  getPending(): PendingTx[] {
    return Array.from(this.pending.values());
  }

  submitSigned(txId: string, signedBase64: string): void {
    this.emitter.emit(`signed:${txId}`, signedBase64);
  }

  submitRejected(txId: string): void {
    this.emitter.emit(`rejected:${txId}`);
  }

  /**
   * Returns a fetch-API Request handler. Mount it in your server:
   *
   *   GET  {base}/pending          → list pending txs for browser to sign
   *   POST {base}/sign/:id         → body: { signedTransaction: base64 }
   *   POST {base}/reject/:id       → user rejected
   */
  createHandler(base = ""): (req: Request) => Promise<Response> {
    return async (req: Request) => {
      const url = new URL(req.url);
      const path = url.pathname.replace(base, "").replace(/^\//, "");
      const [action, id] = path.split("/");

      if (req.method === "GET" && !action) {
        return Response.json({ pending: this.getPending() });
      }

      if (req.method === "POST" && action === "sign" && id) {
        const body = (await req.json()) as { signedTransaction: string };
        this.submitSigned(id, body.signedTransaction);
        return Response.json({ ok: true });
      }

      if (req.method === "POST" && action === "reject" && id) {
        this.submitRejected(id);
        return Response.json({ ok: true });
      }

      return new Response("Not found", { status: 404 });
    };
  }
}
