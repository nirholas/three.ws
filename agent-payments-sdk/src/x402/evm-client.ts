// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import type { Address } from "viem";
import type { SupportedEvmChainId } from "../types.js";
import { getChain } from "../chains.js";

/**
 * x402 payment header encoding for EVM-originated payments.
 *
 * When an agent API returns HTTP 402 with an X-Payment-Required header,
 * this client handles quoting and attaches the payment proof header
 * (X-Payment) to the retry request.
 *
 * Usage:
 *   const fetcher = createEvmX402Fetch({ chainId: 8453, walletClient })
 *   const res = await fetcher("https://agent.example/api/chat", { method: "POST", ... })
 */

export interface EvmX402PaymentRequirements {
  scheme: "pump-agent-evm";
  network: string;
  agentMint: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  memo: string;
  quoteId?: string;
}

export interface EvmWalletClient {
  chainId: SupportedEvmChainId;
  address: Address;
  sendTransaction: (tx: {
    to: Address;
    data: `0x${string}`;
    value: bigint;
    chainId: number;
  }) => Promise<`0x${string}`>;
}

export interface EvmX402FetchOptions {
  walletClient: EvmWalletClient;
  /** Called before signing so the UI can show "paying $X..." */
  onPaymentRequired?: (requirements: EvmX402PaymentRequirements) => Promise<boolean>;
  /** Called after the bridge tx is submitted with the tx hash */
  onPaymentSubmitted?: (txHash: `0x${string}`, depositId: string) => void;
}

/**
 * Returns a fetch-compatible function that automatically handles HTTP 402
 * responses by paying via EVM cross-chain and retrying the request.
 */
export function createEvmX402Fetch(opts: EvmX402FetchOptions) {
  return async function x402Fetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const firstRes = await fetch(input, init);

    if (firstRes.status !== 402) return firstRes;

    const requirementsHeader = firstRes.headers.get("X-Payment-Required");
    if (!requirementsHeader) return firstRes;

    let requirements: EvmX402PaymentRequirements;
    try {
      requirements = JSON.parse(atob(requirementsHeader));
    } catch {
      return firstRes;
    }

    if (requirements.scheme !== "pump-agent-evm") return firstRes;

    // Let the UI confirm before signing
    if (opts.onPaymentRequired) {
      const confirmed = await opts.onPaymentRequired(requirements);
      if (!confirmed) return firstRes;
    }

    const chain = getChain(opts.walletClient.chainId);

    // Build and send the bridge payment
    const { getQuote } = await import("../evm/quote.js");
    const { buildEvmPaymentTransaction } = await import("../evm/transaction.js");

    const quote = await getQuote({
      fromChainId: opts.walletClient.chainId,
      fromToken: chain.usdc,
      fromAmount: BigInt(requirements.maxAmountRequired),
      agentMint: requirements.agentMint,
    });

    const txs = await buildEvmPaymentTransaction({
      quote,
      agentMint: requirements.agentMint,
      destinationSolanaWallet: requirements.payTo,
      memo: requirements.memo,
      sender: opts.walletClient.address,
    });

    // Send approval if needed
    if (txs.approval) {
      await opts.walletClient.sendTransaction({
        to: txs.approval.to,
        data: txs.approval.data,
        value: txs.approval.value,
        chainId: opts.walletClient.chainId,
      });
    }

    // Send bridge tx
    const bridgeTxHash = await opts.walletClient.sendTransaction({
      to: txs.bridge.to,
      data: txs.bridge.data,
      value: txs.bridge.value,
      chainId: txs.bridge.chainId,
    });

    // Build payment proof header
    const paymentProof = btoa(
      JSON.stringify({
        scheme: "pump-agent-evm",
        chainId: opts.walletClient.chainId,
        txHash: bridgeTxHash,
        quoteId: quote.quoteId,
        memo: requirements.memo,
      })
    );

    if (opts.onPaymentSubmitted) {
      opts.onPaymentSubmitted(bridgeTxHash, quote.quoteId);
    }

    // Retry the original request with payment proof
    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set("X-Payment", paymentProof);

    return fetch(input, { ...init, headers: retryHeaders });
  };
}
