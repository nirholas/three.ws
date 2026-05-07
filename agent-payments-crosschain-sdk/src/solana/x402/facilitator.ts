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
  X402_HEADER_PAYMENT_REQUIRED,
  X402_HEADER_PAYMENT_SIGNATURE,
  X402_HEADER_PAYMENT_RESPONSE,
  SOLANA_MAINNET,
  USDC_MAINNET,
} from "./types";

// ─── Settlement Cache ───────────────────────────────────────────────────────

class SettlementCache {
  private cache = new Map<string, number>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize = 10_000, ttlMs = 120_000) {
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
}

// ─── Invoice Memo Generation ────────────────────────────────────────────────

let memoCounter = 0;

function generateMemo(): string {
  const ts = Date.now();
  memoCounter = (memoCounter + 1) % 1_000_000;
  return `${ts}${String(memoCounter).padStart(6, "0")}`;
}

// ─── Pump Agent Facilitator ─────────────────────────────────────────────────

export interface PumpAgentFacilitatorConfig {
  /** Solana RPC connection */
  connection: Connection;
  /** CAIP-2 network (default: SOLANA_MAINNET) */
  network?: string;
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
  private settlementCache = new SettlementCache();

  constructor(config: PumpAgentFacilitatorConfig) {
    this.connection = config.connection;
    this.network = config.network ?? SOLANA_MAINNET;
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

    // Duplicate check
    if (this.settlementCache.has(signature)) {
      return { isValid: false, invalidReason: "Duplicate payment" };
    }

    // Verify amount matches
    if (
      payload.accepted.amount !== requirements.amount ||
      payload.accepted.asset !== requirements.asset
    ) {
      return { isValid: false, invalidReason: "Amount or asset mismatch" };
    }

    try {
      const agent = new PumpAgent(
        new PublicKey(req.extra.agentMint),
        req.network === SOLANA_MAINNET ? "mainnet" : "devnet",
        this.connection,
      );

      const valid = await agent.validateInvoicePayment({
        user: new PublicKey(payer),
        currencyMint: new PublicKey(req.asset),
        amount: Number(req.amount),
        memo: Number(req.extra.memo),
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

    this.settlementCache.set(signature);

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
}

/**
 * Build fresh PumpAgentPaymentRequirements with a unique invoice memo.
 */
export function buildPumpAgentRequirements(
  config: PumpAgentRequirementsConfig,
): PumpAgentPaymentRequirements {
  const windowSec = config.invoiceWindowSeconds ?? 300;
  const now = Math.floor(Date.now() / 1000);

  return {
    scheme: "pump-agent",
    network: config.network ?? SOLANA_MAINNET,
    asset: config.asset ?? USDC_MAINNET,
    amount: config.amount,
    payTo: config.payTo,
    maxTimeoutSeconds: config.maxTimeoutSeconds ?? 60,
    extra: {
      agentMint: config.agentMint,
      memo: generateMemo(),
      startTime: now,
      endTime: now + windowSec,
    },
  };
}

// ─── Resource Server Middleware ──────────────────────────────────────────────

/**
 * Creates a handler wrapper that implements the x402 Resource Server role.
 *
 * On requests without PAYMENT-SIGNATURE: returns 402 with PAYMENT-REQUIRED.
 * On requests with PAYMENT-SIGNATURE: verifies → settles → forwards to handler.
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
    const paymentHeader = request.headers.get(X402_HEADER_PAYMENT_SIGNATURE);

    if (!paymentHeader) {
      // Build fresh requirements (with new invoice memos)
      const body: PaymentRequired = {
        x402Version: X402_VERSION,
        resource,
        accepts: config.requirements,
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
      return new Response("Invalid PAYMENT-SIGNATURE header", { status: 400 });
    }

    // Find the matching requirement
    const accepted = paymentPayload.accepted;
    const matchedReq = config.requirements.find(
      (r) => r.scheme === accepted.scheme && r.network === accepted.network,
    );

    if (!matchedReq) {
      return new Response("No matching payment requirement", { status: 400 });
    }

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

    // Attach PAYMENT-RESPONSE header to the success response
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
