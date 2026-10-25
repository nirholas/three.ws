// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

/**
 * x402 v2 Facilitator & Resource Server
 *
 * Implements the coinbase/x402 3-party architecture:
 *   Client → Resource Server → Facilitator (verify / settle)
 *
 * Provides:
 *   - PumpAgentFacilitator: FacilitatorClient that verifies & settles
 *     "pump-agent" scheme payments using PumpAgent on-chain validation.
 *   - createResourceServer: framework-agnostic Request/Response middleware
 *     that returns 402s, verifies payment via a facilitator, and settles.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PublicKey, Connection } from "@solana/web3.js";
import { PumpAgent } from "../PumpAgent";
import {
  decodePaymentPayload,
  encodePaymentRequired,
  encodePaymentResponse,
} from "./headers";
import type {
  FacilitatorClient,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  PaymentResponse,
  PumpAgentPaymentRequirements,
  ResourceServerConfig,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "./types";
import {
  X402_VERSION,
  X402_HEADER_PAYMENT,
  X402_HEADER_PAYMENT_REQUIRED,
  X402_HEADER_PAYMENT_RESPONSE,
  SOLANA_MAINNET,
  USDC_MAINNET,
} from "./types";

// ─── Replay protection ──────────────────────────────────────────────────────

/**
 * Pluggable consumed-signature store for replay protection.
 *
 * The default {@link SettlementCache} is an in-process Map and therefore only
 * deduplicates within a single process — it does NOT survive a restart or
 * coordinate across replicas/serverless instances. A production resource server
 * that runs more than one instance MUST pass a durable, atomically-claiming
 * store (Redis `SET NX`, a Postgres `INSERT … ON CONFLICT`, etc.) so the same
 * signature can't be redeemed twice across instances. `claim()` returns true
 * exactly once per key: true = this caller won the claim (proceed), false =
 * already consumed (reject as duplicate).
 */
export interface ReplayStore {
  claim(key: string): boolean | Promise<boolean>;
}

// ─── Settlement Cache ───────────────────────────────────────────────────────

/**
 * Default in-process replay-cache TTL. MUST be >= the maximum invoice window
 * (buildPumpAgentRequirements defaults to a 300s window) plus a clock-skew
 * margin, otherwise a proof can age out of the cache while its on-chain invoice
 * is still valid and be replayed for free access (audit #14). 300s window +
 * 120s skew margin = 420s.
 */
const DEFAULT_SETTLEMENT_TTL_MS = 420_000;

class SettlementCache {
  private cache = new Map<string, number>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 10_000, ttlMs = DEFAULT_SETTLEMENT_TTL_MS) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  has(key: string): boolean {
    const ts = this.cache.get(key);
    if (!ts) return false;
    if (Date.now() - ts > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  set(key: string): void {
    this.cache.set(key, Date.now());
    if (this.cache.size > this.maxSize) {
      const cutoff = Date.now() - this.ttlMs;
      for (const [k, v] of this.cache) {
        if (v < cutoff) this.cache.delete(k);
      }
    }
  }

  // Atomic check-and-set: true exactly once per key (single-process only).
  claim(key: string): boolean {
    if (this.has(key)) return false;
    this.set(key);
    return true;
  }
}

// ─── Invoice Memo Generation ────────────────────────────────────────────────

let memoCounter = 0;

function generateMemo(): string {
  const ts = Date.now();
  memoCounter = (memoCounter + 1) % 1_000_000;
  return `${ts}${String(memoCounter).padStart(6, "0")}`;
}

/**
 * Server-bound invoice memos. The on-chain invoice id is client-visible, so
 * without a binding any paid invoice for the same agent, asset and amount
 * (another server's, or a stranger's) could be presented here and redeemed. With
 * an `invoiceSecret` the memo is a u64: the high 40 bits are an HMAC tag over
 * the invoice fields plus a 24-bit nonce in the low bits. Only this server can
 * mint a memo that verifies, and the nonce keeps same-second invoices unique.
 */
const MEMO_NONCE_BITS = 24n;
const MEMO_TAG_BITS = 40n;

function memoTag(
  secret: string,
  fields: { agentMint: string; asset: string; amount: string; payTo: string; startTime: number; endTime: number },
  nonce: bigint,
): bigint {
  const mac = createHmac("sha256", secret)
    .update(
      [fields.agentMint, fields.asset, fields.amount, fields.payTo, fields.startTime, fields.endTime, nonce].join(":"),
    )
    .digest();
  return mac.readBigUInt64BE(0) >> (64n - MEMO_TAG_BITS);
}

function generateSignedMemo(
  secret: string,
  fields: { agentMint: string; asset: string; amount: string; payTo: string; startTime: number; endTime: number },
): string {
  const nonce = BigInt(randomBytes(3).readUIntBE(0, 3));
  return String((memoTag(secret, fields, nonce) << MEMO_NONCE_BITS) | nonce);
}

/** Skew allowed between the issuing clock and the verifying clock, seconds. */
const INVOICE_CLOCK_SKEW_SECONDS = 60;

/**
 * True when the echoed invoice carries a memo this server minted for exactly
 * these fields and its validity window is open now.
 */
function invoiceIsServerBound(secret: string, req: PumpAgentPaymentRequirements): boolean {
  let memo: bigint;
  try {
    memo = BigInt(String(req.extra.memo));
  } catch {
    return false;
  }
  if (memo < 0n || memo >= 1n << 64n) return false;
  const nonce = memo & ((1n << MEMO_NONCE_BITS) - 1n);
  const expected = memoTag(
    secret,
    {
      agentMint: req.extra.agentMint,
      asset: req.asset,
      amount: req.amount,
      payTo: req.payTo,
      startTime: req.extra.startTime,
      endTime: req.extra.endTime,
    },
    nonce,
  );
  const got = Buffer.alloc(8);
  const want = Buffer.alloc(8);
  got.writeBigUInt64BE(memo >> MEMO_NONCE_BITS);
  want.writeBigUInt64BE(expected);
  if (!timingSafeEqual(got, want)) return false;
  const now = Math.floor(Date.now() / 1000);
  return (
    req.extra.startTime <= now + INVOICE_CLOCK_SKEW_SECONDS &&
    now <= req.extra.endTime + INVOICE_CLOCK_SKEW_SECONDS
  );
}

/**
 * Stable logical key for an invoice, mirroring the on-chain invoice-id seeds:
 * (agentMint, currencyMint/asset, amount, memo, startTime, endTime). Used as
 * the replay-store key so a given invoice is single-use regardless of which
 * transaction signature settled it — the memo is freshly minted per 402, so an
 * attacker who pays one invoice cannot redeem it twice (audit #1).
 */
function invoiceKey(req: PumpAgentPaymentRequirements): string {
  return [
    req.extra.agentMint,
    req.asset,
    req.amount,
    String(req.extra.memo),
    String(req.extra.startTime),
    String(req.extra.endTime),
  ].join(":");
}

// ─── Pump Agent Facilitator ─────────────────────────────────────────────────

export interface PumpAgentFacilitatorConfig {
  /** Solana RPC connection */
  connection: Connection;
  /** CAIP-2 network (default: SOLANA_MAINNET) */
  network?: string;
  /**
   * Durable replay store. Defaults to an in-process cache that only
   * deduplicates within a single process — pass a Redis/Postgres-backed
   * {@link ReplayStore} in any multi-instance / serverless deployment so a
   * signature can't be settled twice across instances. See {@link ReplayStore}.
   */
  replayStore?: ReplayStore;
}

/**
 * FacilitatorClient implementation for the "pump-agent" scheme.
 *
 * Uses PumpAgent.validateInvoicePayment() for on-chain verification,
 * and treats the client-submitted transaction signature as the settlement.
 */
export class PumpAgentFacilitator implements FacilitatorClient {
  private connection: Connection;
  private network: string;
  private replayStore: ReplayStore;

  constructor(config: PumpAgentFacilitatorConfig) {
    this.connection = config.connection;
    this.network = config.network ?? SOLANA_MAINNET;
    this.replayStore = config.replayStore ?? new SettlementCache();
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    if (requirements.scheme !== "pump-agent") {
      return { isValid: false, invalidReason: "Unsupported scheme" };
    }

    if (payload.x402Version !== X402_VERSION) {
      return { isValid: false, invalidReason: `Expected x402Version ${X402_VERSION}` };
    }

    const req = requirements as PumpAgentPaymentRequirements;
    const proof = payload.payload as Record<string, unknown>;
    const signature = proof.signature as string | undefined;
    const payer = proof.payer as string | undefined;

    if (!signature || !payer) {
      return { isValid: false, invalidReason: "Missing signature or payer" };
    }

    // NOTE: we deliberately do NOT compare the client-supplied
    // `payload.accepted` against `requirements` — that block is attacker-
    // controlled and proves nothing. The authoritative amount/asset/recipient
    // binding is the on-chain invoice check below, which is driven entirely by
    // the trusted `req` (server-issued requirements): the invoice PDA is derived
    // from (agentMint, currencyMint=req.asset, amount=req.amount, memo, window),
    // and the program only emits the matched payment event when funds reach the
    // agent's canonical vault — so agentMint binds the recipient.
    try {
      const agent = new PumpAgent(
        new PublicKey(req.extra.agentMint),
        req.network === SOLANA_MAINNET ? "mainnet" : "devnet",
        this.connection,
      );

      const valid = await agent.validateInvoicePayment({
        user: new PublicKey(payer),
        currencyMint: new PublicKey(req.asset),
        // Pass the raw decimal strings — Number() would lose precision on
        // atomic USDC amounts and the timestamp-derived memo (both > 2^53).
        amount: req.amount,
        memo: String(req.extra.memo),
        startTime: req.extra.startTime,
        endTime: req.extra.endTime,
      });

      if (!valid) {
        return { isValid: false, invalidReason: "On-chain validation failed", payer };
      }

      return { isValid: true, payer };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isValid: false, invalidReason: `Verification error: ${message}` };
    }
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    // For pump-agent scheme the client already submitted the transaction.
    // We just verify and cache to prevent double-spend.
    const verifyResult = await this.verify(payload, requirements);

    if (!verifyResult.isValid) {
      return {
        success: false,
        errorReason: verifyResult.invalidReason,
        payer: verifyResult.payer,
      };
    }

    const proof = payload.payload as Record<string, unknown>;
    const signature = proof.signature as string;
    const payer = proof.payer as string;
    const req = requirements as PumpAgentPaymentRequirements;

    // Atomically consume the per-request INVOICE (memo + window), not just the
    // signature. The memo is freshly minted per 402, so this makes each invoice
    // single-use: once redeemed it can never be settled again, regardless of
    // the cache TTL or which signature paid it (audit #1, #14). With a durable
    // ReplayStore this is the cross-instance double-spend guard; with the
    // in-memory default it only protects within a single process.
    const claimed = await this.replayStore.claim(invoiceKey(req));
    if (!claimed) {
      return { success: false, errorReason: "Duplicate payment", payer };
    }

    return {
      success: true,
      payer,
      transaction: signature,
      network: this.network,
    };
  }

  async getSupported(): Promise<SupportedResponse> {
    return {
      kinds: [
        {
          scheme: "pump-agent",
          network: this.network,
          asset: USDC_MAINNET,
        },
      ],
    };
  }
}

// ─── Payment Requirements Builder ───────────────────────────────────────────

export interface PumpAgentRequirementsConfig {
  /** Agent token mint (base58) */
  agentMint: string;
  /** Currency / asset mint (base58). Defaults to USDC mainnet */
  asset?: string;
  /** Recipient address (generally the payment vault) */
  payTo: string;
  /** Price in minor units */
  amount: string;
  /** CAIP-2 network (default: SOLANA_MAINNET) */
  network?: string;
  /** Invoice window in seconds (default: 300) */
  invoiceWindowSeconds?: number;
  /** Max settlement timeout in seconds (default: 60) */
  maxTimeoutSeconds?: number;
  /**
   * Server secret that binds each minted memo to this server. Pass the same
   * value to {@link createResourceServer} so it rejects invoices it did not mint.
   */
  invoiceSecret?: string;
}

/**
 * Build fresh PumpAgentPaymentRequirements with a unique invoice memo.
 */
export function buildPumpAgentRequirements(
  config: PumpAgentRequirementsConfig,
): PumpAgentPaymentRequirements {
  const windowSec = config.invoiceWindowSeconds ?? 300;
  const now = Math.floor(Date.now() / 1000);
  const asset = config.asset ?? USDC_MAINNET;

  return {
    scheme: "pump-agent",
    network: config.network ?? SOLANA_MAINNET,
    asset,
    amount: config.amount,
    payTo: config.payTo,
    maxTimeoutSeconds: config.maxTimeoutSeconds ?? 60,
    extra: {
      agentMint: config.agentMint,
      memo: config.invoiceSecret
        ? generateSignedMemo(config.invoiceSecret, {
            agentMint: config.agentMint,
            asset,
            amount: config.amount,
            payTo: config.payTo,
            startTime: now,
            endTime: now + windowSec,
          })
        : generateMemo(),
      startTime: now,
      endTime: now + windowSec,
    },
  };
}

/**
 * Re-mint the per-request invoice fields of a `pump-agent` requirement: a new
 * unique memo and a fresh validity window starting now. Non-invoice fields
 * (amount, asset, payTo, agentMint, network) are preserved from the template.
 * Non-pump-agent requirements are returned unchanged.
 */
function refreshRequirement(
  req: PaymentRequirements,
  invoiceSecret?: string,
): PaymentRequirements {
  if (req.scheme !== "pump-agent") return req;
  const pump = req as PumpAgentPaymentRequirements;
  const now = Math.floor(Date.now() / 1000);
  const windowSec = Math.max(1, pump.extra.endTime - pump.extra.startTime || 300);
  const endTime = now + windowSec;
  return {
    ...pump,
    extra: {
      ...pump.extra,
      memo: invoiceSecret
        ? generateSignedMemo(invoiceSecret, {
            agentMint: pump.extra.agentMint,
            asset: pump.asset,
            amount: pump.amount,
            payTo: pump.payTo,
            startTime: now,
            endTime,
          })
        : generateMemo(),
      startTime: now,
      endTime,
    },
  };
}

/**
 * Produce the `accepts[]` for a 402 response: a caller-supplied
 * {@link ResourceServerConfig.mintRequirements} factory takes precedence;
 * otherwise each configured requirement has its invoice fields refreshed so the
 * memo/window are unique per request (audit #1).
 */
async function mintRequirements(
  config: ResourceServerConfig,
  request: Request,
): Promise<PaymentRequirements[]> {
  if (config.mintRequirements) {
    return config.mintRequirements(request);
  }
  return config.requirements.map((r) => refreshRequirement(r, config.invoiceSecret));
}

/**
 * Guard the client-echoed `accepted` requirement against the configured
 * template: the immutable, server-owned fields (scheme, network, asset, amount,
 * payTo, agentMint) must match exactly so a client cannot downgrade the price,
 * swap the asset, or redirect the recipient by editing the requirement it
 * echoes back. The invoice fields (memo/startTime/endTime) are intentionally
 * NOT compared — they are minted per request and validated on-chain.
 */
function acceptedMatchesTemplate(
  accepted: PaymentRequirements,
  template: PaymentRequirements,
): boolean {
  if (
    accepted.scheme !== template.scheme ||
    accepted.network !== template.network ||
    accepted.asset !== template.asset ||
    accepted.amount !== template.amount ||
    accepted.payTo !== template.payTo
  ) {
    return false;
  }
  if (accepted.scheme === "pump-agent" && template.scheme === "pump-agent") {
    const a = accepted as PumpAgentPaymentRequirements;
    const t = template as PumpAgentPaymentRequirements;
    if (a.extra.agentMint !== t.extra.agentMint) return false;
    // Reject an invoice window outside the configured maximum so a client
    // can't claim an arbitrarily long-lived invoice.
    if (
      !Number.isFinite(a.extra.startTime) ||
      !Number.isFinite(a.extra.endTime) ||
      a.extra.endTime <= a.extra.startTime
    ) {
      return false;
    }
    const templateWindow = Math.max(
      1,
      t.extra.endTime - t.extra.startTime || 300,
    );
    if (a.extra.endTime - a.extra.startTime > templateWindow) return false;
  }
  return true;
}

// ─── Resource Server Middleware ──────────────────────────────────────────────

/**
 * Creates a handler wrapper that implements the x402 Resource Server role.
 *
 * On requests without X-PAYMENT: returns 402 with PaymentRequired body
 *   (mirrored as the `payment-required` header for Bazaar inspection).
 * On requests with X-PAYMENT: verifies → settles → forwards to handler.
 *
 * Works with any framework using the standard Request/Response API
 * (Hono, Next.js App Router, Cloudflare Workers, Bun, Deno, etc.).
 *
 * @example
 * ```ts
 * const gate = createResourceServer({
 *   facilitator: new PumpAgentFacilitator({ connection }),
 *   requirements: [buildPumpAgentRequirements({
 *     agentMint: "YourMint...",
 *     payTo: "PaymentVault...",
 *     amount: "1000000",
 *   })],
 *   resource: { url: "/api/inference", description: "AI call" },
 * });
 *
 * // Hono
 * app.get("/api/inference", (c) =>
 *   gate(c.req.raw, () => c.json({ result: "..." }))
 * );
 * ```
 */
export function createResourceServer(
  config: ResourceServerConfig,
): (
  request: Request,
  handler: () => Response | Promise<Response>,
) => Promise<Response> {
  const { facilitator, resource } = config;

  return async (
    request: Request,
    handler: () => Response | Promise<Response>,
  ): Promise<Response> => {
    const paymentHeader = request.headers.get(X402_HEADER_PAYMENT);

    if (!paymentHeader) {
      // Mint a FRESH invoice per 402: each pump-agent requirement gets a new
      // memo + validity window so the payment the client makes is bound to a
      // single, single-use invoice (audit #1). A static, reused memo/window
      // would let one on-chain payment be replayed across requests.
      const accepts = await mintRequirements(config, request);

      const body: PaymentRequired = {
        x402Version: X402_VERSION,
        resource,
        accepts,
      };

      return new Response(JSON.stringify(body), {
        status: 402,
        statusText: "Payment Required",
        headers: {
          "Content-Type": "application/json",
          [X402_HEADER_PAYMENT_REQUIRED]: encodePaymentRequired(body),
        },
      });
    }

    // Decode the payment payload
    let paymentPayload: PaymentPayload;
    try {
      paymentPayload = decodePaymentPayload(paymentHeader);
    } catch {
      return new Response("Invalid X-PAYMENT header", { status: 400 });
    }

    // The authoritative requirement for verification is the per-request invoice
    // the CLIENT echoes back in `accepted` (it carries the fresh memo/window we
    // issued in the matching 402). We do NOT trust a static server template
    // here, because the invoice fields (memo/startTime/endTime) are now unique
    // per request. We still pin the immutable, server-owned fields (scheme,
    // network, asset, amount, payTo, agentMint) to a configured template so a
    // client can't downgrade the price or redirect the recipient.
    const accepted = paymentPayload.accepted;
    const template = config.requirements.find(
      (r) => r.scheme === accepted.scheme && r.network === accepted.network,
    );

    if (!template) {
      return new Response("No matching payment requirement", { status: 400 });
    }

    if (!acceptedMatchesTemplate(accepted, template)) {
      return new Response("Payment requirement mismatch", { status: 400 });
    }

    if (
      config.invoiceSecret &&
      accepted.scheme === "pump-agent" &&
      !invoiceIsServerBound(config.invoiceSecret, accepted as PumpAgentPaymentRequirements)
    ) {
      return new Response("Invoice was not issued by this server or has expired", {
        status: 400,
      });
    }

    const matchedReq = accepted;

    // Verify
    const verifyResult = await facilitator.verify(paymentPayload, matchedReq);
    if (!verifyResult.isValid) {
      return new Response(
        JSON.stringify({ error: verifyResult.invalidReason }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    }

    // Settle
    const settleResult = await facilitator.settle(paymentPayload, matchedReq);

    if (!settleResult.success) {
      return new Response(
        JSON.stringify({ error: settleResult.errorReason }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    }

    // Invoke the actual handler
    const finalResponse = await handler();

    // Attach X-PAYMENT-RESPONSE header to the success response
    const paymentResponse: PaymentResponse = {
      success: true,
      transaction: settleResult.transaction,
      network: settleResult.network,
      payer: settleResult.payer,
    };

    // Clone to allow header mutation
    const outResponse = new Response(finalResponse.body, {
      status: finalResponse.status,
      statusText: finalResponse.statusText,
      headers: new Headers(finalResponse.headers),
    });
    outResponse.headers.set(
      X402_HEADER_PAYMENT_RESPONSE,
      encodePaymentResponse(paymentResponse),
    );

    return outResponse;
  };
}
