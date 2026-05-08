// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import {
  createPublicClient,
  http,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { AGENT_PAYMENTS_ABI } from "./abi.js";
import { getEvmChain, type EvmChainId } from "./addresses.js";
import { EvmAgentOffline } from "./EvmAgentOffline.js";
import { getInvoiceId } from "./invoice.js";
import { parseEvmAgentEvents } from "./events.js";
import type {
  EvmAgentBalances,
  EvmAgentConfig,
  EvmInvoiceValidationResult,
  EvmPaymentAcceptedEvent,
  EvmPaymentStats,
} from "./types.js";
import { NATIVE_TOKEN_ADDRESS } from "./addresses.js";

/**
 * EvmAgent — extends EvmAgentOffline with RPC reads and invoice validation.
 * Mirrors PumpAgent from the Solana SDK.
 *
 * Usage:
 *   const agent = new EvmAgent("0xYourAgentToken", 8453);
 *   const config = await agent.getAgentConfig();
 *   const balances = await agent.getBalances("0xUSDC...");
 *   const valid = await agent.validateInvoicePayment({ invoiceId, payer, amount, ... });
 */
export class EvmAgent extends EvmAgentOffline {
  private readonly client: PublicClient;

  constructor(
    agentToken: Address,
    chainId: EvmChainId,
    rpcUrl?: string
  ) {
    super(agentToken, chainId);
    const chain = getEvmChain(chainId);
    this.client = createPublicClient({
      transport: http(rpcUrl ?? chain.rpcUrl),
    });
  }

  // ── Read functions ────────────────────────────────────────────────────────

  /** Fetch the agent's on-chain config. Mirrors PumpAgent.getAgentConfig(). */
  async getAgentConfig(): Promise<EvmAgentConfig> {
    const [authority, buybackBps, exists] = await this.client.readContract({
      address: this.contractAddress,
      abi: AGENT_PAYMENTS_ABI,
      functionName: "getAgentConfig",
      args: [this.agentToken],
    }) as [Address, number, boolean];

    return { agentToken: this.agentToken, authority, buybackBps, exists };
  }

  /** Fetch vault balances for a given currency. Mirrors PumpAgent.getAgentBalances(). */
  async getBalances(currencyToken: Address): Promise<EvmAgentBalances> {
    const [paymentVault, buybackVault, withdrawVault] = await this.client.readContract({
      address: this.contractAddress,
      abi: AGENT_PAYMENTS_ABI,
      functionName: "getBalances",
      args: [this.agentToken, currencyToken],
    }) as [bigint, bigint, bigint];

    return {
      agentToken: this.agentToken,
      currencyToken,
      paymentVault,
      buybackVault,
      withdrawVault,
    };
  }

  /** Fetch cumulative payment stats. Mirrors PumpAgent.getPaymentStats(). */
  async getPaymentStats(currencyToken: Address): Promise<EvmPaymentStats> {
    const [totalPayments, totalBuybacks, totalWithdrawn, tokensBurned] =
      await this.client.readContract({
        address: this.contractAddress,
        abi: AGENT_PAYMENTS_ABI,
        functionName: "getPaymentStats",
        args: [this.agentToken, currencyToken],
      }) as [bigint, bigint, bigint, bigint];

    return {
      agentToken: this.agentToken,
      currencyToken,
      totalPayments,
      totalBuybacks,
      totalWithdrawn,
      tokensBurned,
    };
  }

  /** Check if an invoice has already been paid. */
  async isInvoicePaid(invoiceId: Hash): Promise<boolean> {
    return this.client.readContract({
      address: this.contractAddress,
      abi: AGENT_PAYMENTS_ABI,
      functionName: "isInvoicePaid",
      args: [invoiceId],
    }) as Promise<boolean>;
  }

  // ── Invoice validation ────────────────────────────────────────────────────

  /**
   * Validate that a specific invoice has been paid on-chain.
   * Mirrors PumpAgent.validateInvoicePayment().
   *
   * Primary path: checks the isInvoicePaid mapping directly.
   * Fallback: scans PaymentAccepted events for matching parameters.
   */
  async validateInvoicePayment(params: {
    currencyToken: Address | "native";
    amount: bigint;
    memo: bigint;
    startTime: bigint;
    endTime: bigint;
    payer?: Address;
  }): Promise<EvmInvoiceValidationResult> {
    const currency =
      params.currencyToken === "native" ? NATIVE_TOKEN_ADDRESS : params.currencyToken;

    const invoiceId = getInvoiceId(
      this.agentToken,
      currency,
      params.amount,
      params.memo,
      params.startTime,
      params.endTime
    );

    // Primary: direct mapping lookup
    const paid = await this.isInvoicePaid(invoiceId);
    if (paid) {
      return { paid: true, invoiceId };
    }

    // Fallback: scan event logs for a matching PaymentAccepted event
    try {
      const logs = await this.client.getLogs({
        address: this.contractAddress,
        event: AGENT_PAYMENTS_ABI.find((x) => x.type === "event" && x.name === "PaymentAccepted") as any,
        args: { agentToken: this.agentToken, payer: params.payer },
        fromBlock: "earliest",
      });

      const events = parseEvmAgentEvents(logs as any);
      const match = events.find(
        (e): e is EvmPaymentAcceptedEvent =>
          e.name === "PaymentAccepted" &&
          e.invoiceId.toLowerCase() === invoiceId.toLowerCase()
      );

      if (match) {
        return {
          paid: true,
          invoiceId,
          txHash: match.txHash,
          blockNumber: match.blockNumber,
        };
      }
    } catch {
      // Fallback failed — return primary result
    }

    return { paid: false, invoiceId };
  }

  /**
   * Get recent PaymentAccepted events for this agent.
   * Mirrors PumpAgent payment history queries.
   */
  async getPaymentHistory(opts: {
    currencyToken?: Address;
    payer?: Address;
    fromBlock?: bigint;
    toBlock?: bigint;
  } = {}) {
    const logs = await this.client.getLogs({
      address: this.contractAddress,
      event: AGENT_PAYMENTS_ABI.find((x) => x.type === "event" && x.name === "PaymentAccepted") as any,
      args: {
        agentToken: this.agentToken,
        ...(opts.payer ? { payer: opts.payer } : {}),
      },
      fromBlock: opts.fromBlock ?? "earliest",
      toBlock: opts.toBlock ?? "latest",
    });

    return parseEvmAgentEvents(logs as any).filter(
      (e): e is EvmPaymentAcceptedEvent =>
        e.name === "PaymentAccepted" &&
        (!opts.currencyToken ||
          e.currencyToken.toLowerCase() === opts.currencyToken.toLowerCase())
    );
  }
}
