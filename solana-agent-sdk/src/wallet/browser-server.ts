/**
 * BrowserWalletProvider — server-side half of the browser wallet bridge.
 *
 * The agent calls signAndSendTransaction() as normal. Internally this creates a
 * pending request that the browser can pick up, sign with Phantom/Solflare, and
 * submit back. The Promise resolves once the browser returns the signed tx.
 *
 * Call setNextMeta() before any action to attach a human-readable description
 * to the pending tx — the browser can show a confirmation card before the
 * wallet prompt appears.
 *
 * Mount createHandler() on any HTTP path (e.g. GET/POST /api/wallet/...).
 * Point BrowserWalletClient (browser-client.ts) at the same base URL.
 */
import { EventEmitter } from "events";
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import type { MetaAwareWallet, TxMetadata } from "./types.js";

export interface PendingTx {
  id: string;
  transaction: string;
  versioned: boolean;
  createdAt: number;
  meta?: TxMetadata;
}

export interface BrowserWalletOptions {
  publicKey: PublicKey | string;
  sessionId?: string;
  timeoutMs?: number;
}

export class BrowserWalletProvider implements MetaAwareWallet {
  readonly publicKey: PublicKey;
  readonly sessionId: string;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingTx>();
  private readonly emitter = new EventEmitter();
  private nextMeta: TxMetadata | null = null;

  constructor(opts: BrowserWalletOptions) {
    this.publicKey =
      typeof opts.publicKey === "string"
        ? new PublicKey(opts.publicKey)
        : opts.publicKey;
    this.sessionId = opts.sessionId ?? crypto.randomUUID();
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  /**
   * Attach metadata to the next transaction this provider signs.
   * Consumed once — subsequent calls without setting it again won't carry metadata.
   *
   * Call this immediately before the action that triggers a transaction:
   *   walletProvider.setNextMeta({ label: "Swap SOL → USDC", kind: "swap", ... });
   *   await agent.swap(...);
   */
  setNextMeta(meta: TxMetadata): void {
    this.nextMeta = meta;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const id = crypto.randomUUID();
    const versioned = !(tx instanceof Transaction);
    const serialized = Buffer.from(
      tx instanceof Transaction
        ? tx.serialize({ requireAllSignatures: false })
        : tx.serialize(),
    ).toString("base64");

    const meta = this.nextMeta ?? undefined;
    this.nextMeta = null;

    this.pending.set(id, { id, transaction: serialized, versioned, createdAt: Date.now(), meta });
    this.emitter.emit("pending", this.pending.get(id));

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
   * Subscribe to new pending tx events (for SSE streaming).
   * Returns an unsubscribe function.
   */
  onPending(listener: (tx: PendingTx) => void): () => void {
    this.emitter.on("pending", listener);
    return () => this.emitter.off("pending", listener);
  }

  /**
   * Returns a fetch-API Request handler. Mount it in your server:
   *
   *   GET  {base}/pending          → list all current pending txs
   *   GET  {base}/stream           → SSE stream of new pending txs
   *   POST {base}/sign/:id         → body: { signedTransaction: base64 }
   *   POST {base}/reject/:id       → user rejected
   */
  createHandler(base = ""): (req: Request) => Promise<Response> {
    return async (req: Request) => {
      const url = new URL(req.url);
      const path = url.pathname.replace(base, "").replace(/^\//, "");
      const [action, id] = path.split("/");

      // GET /pending — snapshot of current queue
      if (req.method === "GET" && !action) {
        return Response.json({ pending: this.getPending() });
      }

      // GET /stream — SSE push stream
      if (req.method === "GET" && action === "stream") {
        const { readable, writable } = new TransformStream<string, string>();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // Flush current pending on connect
        for (const tx of this.getPending()) {
          await writer.write(encoder.encode(`data: ${JSON.stringify(tx)}\n\n`));
        }

        const unsub = this.onPending(async (tx) => {
          try {
            await writer.write(encoder.encode(`data: ${JSON.stringify(tx)}\n\n`));
          } catch {
            unsub();
          }
        });

        req.signal?.addEventListener("abort", () => {
          unsub();
          writer.close().catch(() => undefined);
        });

        return new Response(readable as unknown as BodyInit, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // POST /sign/:id
      if (req.method === "POST" && action === "sign" && id) {
        const body = (await req.json()) as { signedTransaction: string };
        this.submitSigned(id, body.signedTransaction);
        return Response.json({ ok: true });
      }

      // POST /reject/:id
      if (req.method === "POST" && action === "reject" && id) {
        this.submitRejected(id);
        return Response.json({ ok: true });
      }

      return new Response("Not found", { status: 404 });
    };
  }
}
