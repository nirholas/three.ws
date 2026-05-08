// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import {
  encodeFunctionData,
  maxUint256,
  type Address,
  type Hex,
} from "viem";
import { AGENT_PAYMENTS_ABI, ERC20_ABI } from "./abi.js";
import { getEvmChain, NATIVE_TOKEN_ADDRESS, type EvmChainId } from "./addresses.js";
import { getInvoiceId, buildInvoiceWindow, generateMemo } from "./invoice.js";
import type {
  EvmAcceptPaymentParams,
  EvmBuybackTriggerParams,
  EvmCreateParams,
  EvmDistributePaymentsParams,
  EvmTxBundle,
  EvmUnsignedTx,
  EvmUpdateAuthorityParams,
  EvmUpdateBuybackBpsParams,
  EvmWithdrawParams,
} from "./types.js";

/**
 * EvmAgentOffline — builds unsigned EVM transactions for the Agent Payments contract.
 * No RPC connection required. Mirrors PumpAgentOffline from the Solana SDK.
 *
 * Usage:
 *   const agent = new EvmAgentOffline("0xYourAgentToken", 8453);
 *   const bundle = agent.buildAcceptPaymentTx({ ... });
 *   // send bundle.approval then bundle.tx via user's wallet
 */
export class EvmAgentOffline {
  readonly agentToken: Address;
  readonly chainId: EvmChainId;
  readonly contractAddress: Address;

  constructor(agentToken: Address, chainId: EvmChainId) {
    this.agentToken = agentToken;
    this.chainId = chainId;
    this.contractAddress = getEvmChain(chainId).agentPayments;
  }

  // ── Agent setup ────────────────────────────────────────────────────────────

  /** Build the createAgent transaction (one-time agent registration). */
  buildCreateAgentTx(params: EvmCreateParams): EvmUnsignedTx {
    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "createAgent",
        args: [params.agentToken, params.agentAuthority, params.buybackBps],
      }),
      value: 0n,
      chainId: this.chainId,
    };
  }

  // ── Payment acceptance ────────────────────────────────────────────────────

  /**
   * Build the acceptPayment transaction bundle.
   * Returns an optional ERC-20 approval + the main payment tx.
   *
   * For native currency (ETH/BNB/AVAX), pass currencyToken as "native".
   * The value field on the tx will be set to the payment amount.
   */
  buildAcceptPaymentTx(
    params: EvmAcceptPaymentParams,
    payer: Address
  ): EvmTxBundle {
    const isNative = params.currencyToken === "native";

    if (isNative) {
      return {
        tx: {
          to: this.contractAddress,
          data: encodeFunctionData({
            abi: AGENT_PAYMENTS_ABI,
            functionName: "acceptPaymentNative",
            args: [
              params.agentToken,
              params.memo,
              params.startTime,
              params.endTime,
            ],
          }),
          value: params.amount,
          chainId: this.chainId,
        },
      };
    }

    const approval: EvmUnsignedTx = {
      to: params.currencyToken as Address,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [this.contractAddress, maxUint256],
      }),
      value: 0n,
      chainId: this.chainId,
    };

    const tx: EvmUnsignedTx = {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "acceptPayment",
        args: [
          params.agentToken,
          params.currencyToken as Address,
          params.amount,
          params.memo,
          params.startTime,
          params.endTime,
        ],
      }),
      value: 0n,
      chainId: this.chainId,
    };

    return { approval, tx };
  }

  /**
   * Convenience wrapper: auto-generates memo + time window.
   * Mirrors PumpAgentOffline.buildAcceptPaymentInstructions().
   */
  buildAcceptPaymentInstructions(opts: {
    agentToken: Address;
    currencyToken: Address | "native";
    amount: bigint;
    payer: Address;
    windowSeconds?: number;
  }): { bundle: EvmTxBundle; memo: bigint; invoiceId: Hex } {
    const memo = generateMemo();
    const { startTime, endTime } = buildInvoiceWindow(opts.windowSeconds);
    const currencyAddress =
      opts.currencyToken === "native" ? NATIVE_TOKEN_ADDRESS : opts.currencyToken;

    const invoiceId = getInvoiceId(
      opts.agentToken,
      currencyAddress,
      opts.amount,
      memo,
      startTime,
      endTime
    );

    const bundle = this.buildAcceptPaymentTx(
      {
        agentToken: opts.agentToken,
        currencyToken: opts.currencyToken,
        amount: opts.amount,
        memo,
        startTime,
        endTime,
      },
      opts.payer
    );

    return { bundle, memo, invoiceId };
  }

  // ── Distribution + buyback ─────────────────────────────────────────────────

  /** Build the distributePayments transaction. Permissionless. */
  buildDistributePaymentsTx(params: EvmDistributePaymentsParams): EvmUnsignedTx {
    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "distributePayments",
        args: [params.agentToken, params.currencyToken],
      }),
      value: 0n,
      chainId: this.chainId,
    };
  }

  /** Build the buybackTrigger transaction. Caller must be global buyback authority. */
  buildBuybackTriggerTx(params: EvmBuybackTriggerParams): EvmUnsignedTx {
    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "buybackTrigger",
        args: [
          params.agentToken,
          params.currencyToken,
          params.swapRouter,
          params.swapData,
        ],
      }),
      value: 0n,
      chainId: this.chainId,
    };
  }

  // ── Withdrawal ─────────────────────────────────────────────────────────────

  /** Build the withdraw transaction. Caller must be agent authority. */
  buildWithdrawTx(params: EvmWithdrawParams): EvmUnsignedTx {
    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "withdraw",
        args: [params.agentToken, params.currencyToken, params.receiver],
      }),
      value: 0n,
      chainId: this.chainId,
    };
  }

  // ── Config updates ─────────────────────────────────────────────────────────

  buildUpdateBuybackBpsTx(params: EvmUpdateBuybackBpsParams): EvmUnsignedTx {
    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "updateBuybackBps",
        args: [params.agentToken, params.buybackBps],
      }),
      value: 0n,
      chainId: this.chainId,
    };
  }

  buildUpdateAuthorityTx(params: EvmUpdateAuthorityParams): EvmUnsignedTx {
    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: AGENT_PAYMENTS_ABI,
        functionName: "updateAuthority",
        args: [params.agentToken, params.newAuthority],
      }),
      value: 0n,
      chainId: this.chainId,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Compute the invoice ID for a payment without sending anything. */
  computeInvoiceId(
    currencyToken: Address | "native",
    amount: bigint,
    memo: bigint,
    startTime: bigint,
    endTime: bigint
  ): Hex {
    const currency =
      currencyToken === "native" ? NATIVE_TOKEN_ADDRESS : currencyToken;
    return getInvoiceId(this.agentToken, currency, amount, memo, startTime, endTime);
  }
}
