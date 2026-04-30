/**
 * BrowserWalletClient — browser-side half of the wallet bridge.
 *
 * Listens for pending transactions via SSE (instant push, no polling), then
 * either auto-signs or calls the optional `onApproval` handler first so your
 * UI can show a confirmation card before the wallet prompt appears.
 *
 * Works in any browser — no Node.js APIs, no React dependency.
 *
 * Quick start (auto-sign everything):
 *   const client = new BrowserWalletClient("/api/wallet", wallet.signTransaction.bind(wallet));
 *   client.connect();
 *
 * With confirmation UI:
 *   const client = new BrowserWalletClient("/api/wallet", signer, {
 *     onApproval: (pending, approve, reject) => {
 *       showConfirmModal(pending.meta, approve, reject);
 *     },
 *   });
 *   client.connect();
 */
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import type { TxMetadata } from "./types.js";

export type SignerFn = (
  tx: Transaction | VersionedTransaction,
) => Promise<Transaction | VersionedTransaction>;

export interface PendingTx {
  id: string;
  transaction: string;
  versioned: boolean;
  createdAt: number;
  meta?: TxMetadata;
}

export type ApprovalHandler = (
  pending: PendingTx,
  approve: () => void,
  reject: () => void,
) => void;

export interface BrowserWalletClientOptions {
  /**
   * Called with each pending tx before the wallet prompt.
   * Must call approve() or reject() — whichever the user chooses.
   * If omitted, all transactions are auto-approved (no confirmation UI).
   */
  onApproval?: ApprovalHandler;
  /**
   * Called after a transaction is confirmed on-chain.
   * Useful for showing a success toast or updating chat state.
   */
  onConfirmed?: (pending: PendingTx, signature: string) => void;
  /**
   * Called when a transaction is rejected by the user or the wallet.
   */
  onRejected?: (pending: PendingTx, reason: string) => void;
  /**
   * Reconnect delay in ms after SSE drops (default 2000).
   */
  reconnectMs?: number;
}

export class BrowserWalletClient {
  private readonly baseUrl: string;
  private readonly signer: SignerFn;
  private readonly opts: BrowserWalletClientOptions;
  private eventSource: EventSource | null = null;
  private processing = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    baseUrl: string,
    signer: SignerFn,
    opts: BrowserWalletClientOptions = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.signer = signer;
    this.opts = opts;
  }

  /** Open the SSE connection and start handling pending transactions. */
  connect(): void {
    if (this.eventSource) return;
    this.openStream();
  }

  /** Close the SSE connection and stop processing. */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private openStream(): void {
    const es = new EventSource(`${this.baseUrl}/stream`);
    this.eventSource = es;

    es.onmessage = (event: MessageEvent<string>) => {
      const pending = JSON.parse(event.data) as PendingTx;
      if (!this.processing.has(pending.id)) {
        this.processing.add(pending.id);
        void this.handle(pending).finally(() => this.processing.delete(pending.id));
      }
    };

    es.onerror = () => {
      es.close();
      this.eventSource = null;
      const delay = this.opts.reconnectMs ?? 2_000;
      this.reconnectTimer = setTimeout(() => this.openStream(), delay);
    };
  }

  private handle(pending: PendingTx): Promise<void> {
    return new Promise<void>((resolve) => {
      const proceed = () => void this.sign(pending).then(resolve, resolve);
      const decline = () => {
        void this.reject(pending, "User rejected");
        resolve();
      };

      if (this.opts.onApproval) {
        this.opts.onApproval(pending, proceed, decline);
      } else {
        proceed();
      }
    });
  }

  private async sign(pending: PendingTx): Promise<void> {
    const buf = base64ToUint8Array(pending.transaction);
    const tx = pending.versioned
      ? VersionedTransaction.deserialize(buf)
      : Transaction.from(buf);

    let signed: Transaction | VersionedTransaction;
    try {
      signed = await this.signer(tx);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Wallet rejected";
      await this.reject(pending, reason);
      return;
    }

    const serialized = uint8ArrayToBase64(signed.serialize());
    const res = await fetch(`${this.baseUrl}/sign/${pending.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedTransaction: serialized }),
    });

    if (res.ok) {
      const { signature } = (await res.json()) as { signature?: string };
      if (signature) this.opts.onConfirmed?.(pending, signature);
    }
  }

  private async reject(pending: PendingTx, reason: string): Promise<void> {
    await fetch(`${this.baseUrl}/reject/${pending.id}`, { method: "POST" }).catch(() => undefined);
    this.opts.onRejected?.(pending, reason);
  }
}

// ─── Base64 helpers (no Buffer — browser safe) ────────────────────────────────

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary);
}
