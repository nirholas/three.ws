// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import type { Address, Hash, Hex } from "viem";
import type { EvmChainId } from "./addresses.js";

/** Mirrors Solana's TokenAgentPayments account */
export interface EvmAgentConfig {
  agentToken: Address;
  authority: Address;
  buybackBps: number;
  exists: boolean;
}

/** Mirrors Solana's AgentBalances */
export interface EvmAgentBalances {
  agentToken: Address;
  currencyToken: Address;
  paymentVault: bigint;
  buybackVault: bigint;
  withdrawVault: bigint;
}

/** Mirrors Solana's TokenAgentPaymentInCurrency */
export interface EvmPaymentStats {
  agentToken: Address;
  currencyToken: Address;
  totalPayments: bigint;
  totalBuybacks: bigint;
  totalWithdrawn: bigint;
  tokensBurned: bigint;
}

/** Mirrors Solana's CreateParams */
export interface EvmCreateParams {
  agentToken: Address;
  agentAuthority: Address;
  buybackBps: number;
}

/** Mirrors Solana's AcceptPaymentSimpleParams */
export interface EvmAcceptPaymentParams {
  agentToken: Address;
  currencyToken: Address | "native";
  amount: bigint;
  memo: bigint;
  startTime: bigint;
  endTime: bigint;
}

/** Mirrors Solana's DistributePaymentsParams */
export interface EvmDistributePaymentsParams {
  agentToken: Address;
  currencyToken: Address;
}

/** Mirrors Solana's BuybackTriggerParams */
export interface EvmBuybackTriggerParams {
  agentToken: Address;
  currencyToken: Address;
  swapRouter: Address;
  swapData: Hex;
}

/** Mirrors Solana's WithdrawParams */
export interface EvmWithdrawParams {
  agentToken: Address;
  currencyToken: Address;
  receiver: Address;
}

export interface EvmUpdateBuybackBpsParams {
  agentToken: Address;
  buybackBps: number;
}

export interface EvmUpdateAuthorityParams {
  agentToken: Address;
  newAuthority: Address;
}

/** A built unsigned EVM transaction ready for the user's wallet to sign */
export interface EvmUnsignedTx {
  to: Address;
  data: Hex;
  value: bigint;
  chainId: EvmChainId;
}

/** An optional ERC-20 approval + main transaction pair */
export interface EvmTxBundle {
  /** ERC-20 approval — present when paying with an ERC-20 token */
  approval?: EvmUnsignedTx;
  /** The main contract call */
  tx: EvmUnsignedTx;
}

/** Mirrors Solana's invoice validation result */
export interface EvmInvoiceValidationResult {
  paid: boolean;
  invoiceId: Hash;
  txHash?: Hash;
  blockNumber?: bigint;
}

// ── Events (mirrors Solana event types) ─────────────────────────────────────

export interface EvmAgentCreatedEvent {
  name: "AgentCreated";
  agentToken: Address;
  authority: Address;
  buybackBps: number;
  txHash: Hash;
  blockNumber: bigint;
}

export interface EvmPaymentAcceptedEvent {
  name: "PaymentAccepted";
  agentToken: Address;
  payer: Address;
  currencyToken: Address;
  amount: bigint;
  memo: bigint;
  invoiceId: Hash;
  txHash: Hash;
  blockNumber: bigint;
}

export interface EvmPaymentsDistributedEvent {
  name: "PaymentsDistributed";
  agentToken: Address;
  currencyToken: Address;
  buybackAmount: bigint;
  withdrawAmount: bigint;
  txHash: Hash;
  blockNumber: bigint;
}

export interface EvmBuybackTriggeredEvent {
  name: "BuybackTriggered";
  agentToken: Address;
  currencyToken: Address;
  currencySpent: bigint;
  tokensBurned: bigint;
  txHash: Hash;
  blockNumber: bigint;
}

export interface EvmWithdrawnEvent {
  name: "Withdrawn";
  agentToken: Address;
  authority: Address;
  currencyToken: Address;
  amount: bigint;
  receiver: Address;
  txHash: Hash;
  blockNumber: bigint;
}

export type EvmAgentEvent =
  | EvmAgentCreatedEvent
  | EvmPaymentAcceptedEvent
  | EvmPaymentsDistributedEvent
  | EvmBuybackTriggeredEvent
  | EvmWithdrawnEvent;
