// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import type { Address, Hash, Hex } from "viem";

export type SupportedEvmChainId =
  | 1      // Ethereum
  | 8453   // Base
  | 42161  // Arbitrum One
  | 137    // Polygon
  | 56     // BNB Smart Chain
  | 43114; // Avalanche

export interface EvmChainConfig {
  id: SupportedEvmChainId;
  name: string;
  rpcUrl: string;
  blockExplorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  usdc: Address;
  /** MoonPay network identifier for deposit routing */
  moonpayNetwork: string;
}

/** A cross-chain payment quote returned before the user signs anything. */
export interface CrossChainQuote {
  /** Chain the user is paying from */
  fromChainId: SupportedEvmChainId;
  /** Token the user is paying with (address or "native") */
  fromToken: Address | "native";
  /** Amount the user sends, in the fromToken's smallest unit */
  fromAmount: bigint;
  /** Amount the agent vault receives in USDC on Solana (6 decimals) */
  toAmountUsdc: bigint;
  /** Estimated USD value of the payment */
  estimatedUsd: number;
  /** Bridge/routing fee in USD */
  bridgeFeeUsd: number;
  /** Estimated seconds for funds to arrive on Solana */
  estimatedTimeSeconds: number;
  /** Opaque ID used to track this quote through to settlement */
  quoteId: string;
  /** Unix timestamp after which this quote expires */
  expiresAt: number;
}

/** Parameters for building the EVM-side payment transaction. */
export interface EvmPaymentParams {
  quote: CrossChainQuote;
  /** Solana agent token mint address (base58) */
  agentMint: string;
  /** Solana wallet address that will be credited (base58) */
  destinationSolanaWallet: string;
  /** Arbitrary memo / invoice identifier (u64 as string) */
  memo: string;
  /** EVM payer address */
  sender: Address;
}

/** The built EVM transaction(s) ready for the user to sign. */
export interface EvmPaymentTransaction {
  /** ERC-20 approval tx — undefined when paying with native ETH */
  approval?: {
    to: Address;
    data: Hex;
    value: bigint;
  };
  /** The bridge / swap transaction */
  bridge: {
    to: Address;
    data: Hex;
    value: bigint;
    chainId: SupportedEvmChainId;
  };
}

/** Result returned after the EVM transaction is confirmed. */
export interface EvmPaymentReceipt {
  txHash: Hash;
  chainId: SupportedEvmChainId;
  fromAmount: bigint;
  fromToken: Address | "native";
  /** MoonPay deposit/order ID for status polling */
  depositId: string;
  /** Estimated Solana arrival time as unix timestamp */
  estimatedArrivalAt: number;
}

/** Status of an in-flight cross-chain payment. */
export type CrossChainPaymentStatus =
  | "pending_evm_confirmation"
  | "bridging"
  | "arrived_on_solana"
  | "failed";

export interface CrossChainPaymentStatusResult {
  status: CrossChainPaymentStatus;
  depositId: string;
  solanaSignature?: string;
  error?: string;
}
