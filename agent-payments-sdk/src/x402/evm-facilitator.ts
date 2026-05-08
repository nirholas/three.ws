// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import type { Address } from "viem";
import type { CrossChainPaymentStatusResult, SupportedEvmChainId } from "../types.js";
import { getPaymentStatus } from "../evm/validate.js";
import { PUMP_CROSSCHAIN_API } from "../constants.js";

export interface EvmPaymentProof {
  scheme: "pump-agent-evm";
  chainId: SupportedEvmChainId;
  txHash: `0x${string}`;
  quoteId: string;
  memo: string;
}

export interface VerifyEvmPaymentParams {
  /** Decoded proof from the X-Payment header */
  proof: EvmPaymentProof;
  /** Expected memo / invoice ID */
  expectedMemo: string;
  /** Minimum USDC amount that must arrive on Solana (6 decimals) */
  minAmountUsdc: bigint;
  /** Solana agent mint for this agent */
  agentMint: string;
  /**
   * Whether to wait for Solana arrival before returning.
   * Set to false if you want to verify the EVM tx only and handle
   * Solana arrival asynchronously (webhook / queue).
   */
  waitForSolana?: boolean;
}

export interface EvmPaymentVerificationResult {
  valid: boolean;
  /** Deposit ID for status polling */
  depositId?: string;
  /** Solana tx signature (only when waitForSolana: true and arrived) */
  solanaSignature?: string;
  /** Amount confirmed on Solana (6-decimal USDC) */
  confirmedAmountUsdc?: bigint;
  error?: string;
}

/**
 * Server-side facilitator: verify an EVM payment proof from the X-Payment header.
 *
 * Call this from your API route after decoding the X-Payment header:
 *
 *   const proof = JSON.parse(atob(req.headers["x-payment"]))
 *   const result = await verifyEvmPayment({ proof, expectedMemo, minAmountUsdc, agentMint })
 *   if (!result.valid) return res.status(402).json({ error: result.error })
 */
export async function verifyEvmPayment(
  params: VerifyEvmPaymentParams
): Promise<EvmPaymentVerificationResult> {
  const { proof, expectedMemo, minAmountUsdc, agentMint } = params;

  if (proof.scheme !== "pump-agent-evm") {
    return { valid: false, error: "Unknown payment scheme" };
  }

  if (proof.memo !== expectedMemo) {
    return { valid: false, error: "Memo mismatch" };
  }

  // Fetch the deposit record from Pump.fun API using the quoteId / txHash
  let depositId: string;
  try {
    const res = await fetch(
      `${PUMP_CROSSCHAIN_API}/deposit?txHash=${proof.txHash}&chainId=${proof.chainId}`
    );
    if (!res.ok) throw new Error(`Deposit lookup failed (${res.status})`);
    const data: { depositId: string; amountUsdc: string } = await res.json();
    depositId = data.depositId;

    const confirmedAmount = BigInt(data.amountUsdc);
    if (confirmedAmount < minAmountUsdc) {
      return {
        valid: false,
        depositId,
        error: `Insufficient amount: got ${confirmedAmount}, need ${minAmountUsdc}`,
      };
    }
  } catch (err) {
    return {
      valid: false,
      error: `EVM tx verification failed: ${(err as Error).message}`,
    };
  }

  if (!params.waitForSolana) {
    return { valid: true, depositId };
  }

  // Wait for Solana arrival
  try {
    const status: CrossChainPaymentStatusResult = await waitWithTimeout(depositId);

    if (status.status === "arrived_on_solana") {
      return {
        valid: true,
        depositId,
        solanaSignature: status.solanaSignature,
      };
    }

    return {
      valid: false,
      depositId,
      error: `Payment failed in transit: ${status.error ?? status.status}`,
    };
  } catch (err) {
    return {
      valid: false,
      depositId,
      error: `Solana arrival timeout: ${(err as Error).message}`,
    };
  }
}

async function waitWithTimeout(
  depositId: string,
  maxMs = 60_000
): Promise<CrossChainPaymentStatusResult> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const status = await getPaymentStatus(depositId);
    if (status.status === "arrived_on_solana" || status.status === "failed") {
      return status;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`Timed out waiting for Solana arrival (${maxMs}ms)`);
}

/**
 * Decode and validate the X-Payment header from an incoming request.
 * Returns null if the header is missing or malformed.
 */
export function decodePaymentHeader(
  headerValue: string | null | undefined
): EvmPaymentProof | null {
  if (!headerValue) return null;
  try {
    const decoded = JSON.parse(atob(headerValue));
    if (decoded.scheme !== "pump-agent-evm") return null;
    return decoded as EvmPaymentProof;
  } catch {
    return null;
  }
}

/**
 * Build the X-Payment-Required header value for an agent API endpoint.
 * Include this in HTTP 402 responses so EVM clients know how to pay.
 */
export function buildPaymentRequiredHeader(opts: {
  agentMint: string;
  maxAmountUsdc: bigint;
  resource: string;
  description: string;
  payTo: Address;
  memo: string;
}): string {
  return btoa(
    JSON.stringify({
      scheme: "pump-agent-evm",
      agentMint: opts.agentMint,
      maxAmountRequired: opts.maxAmountUsdc.toString(),
      resource: opts.resource,
      description: opts.description,
      payTo: opts.payTo,
      memo: opts.memo,
    })
  );
}
