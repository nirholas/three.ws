// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import type { Address } from "viem";
import type { CrossChainQuote, SupportedEvmChainId } from "../types.js";
import { getChain } from "../chains.js";
import { PUMP_CROSSCHAIN_API, QUOTE_EXPIRY_BUFFER_SECONDS } from "../constants.js";

export interface QuoteRequest {
  fromChainId: SupportedEvmChainId;
  /** Token address to pay with, or "native" for the chain's native currency */
  fromToken: Address | "native";
  /** Amount in the token's smallest unit (wei for ETH, 6-decimal for USDC) */
  fromAmount: bigint;
  /** Solana agent token mint the payment is destined for */
  agentMint: string;
}

interface PumpCrossChainQuoteResponse {
  quoteId: string;
  fromChainId: number;
  fromToken: string;
  fromAmount: string;
  toAmountUsdc: string;
  estimatedUsd: number;
  bridgeFeeUsd: number;
  estimatedTimeSeconds: number;
  expiresAt: number;
}

/**
 * Fetch a cross-chain payment quote from Pump.fun's routing API.
 * The quote is valid for ~60 seconds (check expiresAt before submitting).
 */
export async function getQuote(
  request: QuoteRequest,
  apiKey?: string
): Promise<CrossChainQuote> {
  const chain = getChain(request.fromChainId);
  const fromTokenAddr =
    request.fromToken === "native"
      ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
      : request.fromToken;

  const params = new URLSearchParams({
    fromChainId: String(request.fromChainId),
    fromToken: fromTokenAddr,
    fromAmount: String(request.fromAmount),
    toNetwork: "solana",
    toToken: "usdc",
    agentMint: request.agentMint,
    fromNetwork: chain.moonpayNetwork,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["x-api-key"] = apiKey;

  const res = await fetch(`${PUMP_CROSSCHAIN_API}/quote?${params}`, { headers });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Quote request failed (${res.status}): ${body}`);
  }

  const data: PumpCrossChainQuoteResponse = await res.json();

  return {
    fromChainId: request.fromChainId,
    fromToken: request.fromToken,
    fromAmount: BigInt(data.fromAmount),
    toAmountUsdc: BigInt(data.toAmountUsdc),
    estimatedUsd: data.estimatedUsd,
    bridgeFeeUsd: data.bridgeFeeUsd,
    estimatedTimeSeconds: data.estimatedTimeSeconds,
    quoteId: data.quoteId,
    expiresAt: data.expiresAt,
  };
}

/** Throws if the quote has expired (with buffer). */
export function assertQuoteValid(quote: CrossChainQuote): void {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds >= quote.expiresAt - QUOTE_EXPIRY_BUFFER_SECONDS) {
    throw new Error(
      `Quote ${quote.quoteId} has expired. Fetch a new quote before submitting.`
    );
  }
}

/**
 * Convenience: get the USD price of a token amount using Pump.fun price API.
 * Useful for displaying "you're paying ~$X" before fetching a full quote.
 */
export async function getTokenUsdPrice(
  chainId: SupportedEvmChainId,
  tokenAddress: Address | "native"
): Promise<number> {
  const chain = getChain(chainId);
  const addr =
    tokenAddress === "native"
      ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
      : tokenAddress;

  const res = await fetch(
    `${PUMP_CROSSCHAIN_API}/price?network=${chain.moonpayNetwork}&token=${addr}`
  );
  if (!res.ok) throw new Error(`Price fetch failed (${res.status})`);
  const data: { usdPrice: number } = await res.json();
  return data.usdPrice;
}
