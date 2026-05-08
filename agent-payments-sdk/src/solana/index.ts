// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

/**
 * @pump-fun/agent-payments-sdk
 * TypeScript SDK for Pump Agent Payments
 */

// IDL type
export type { PumpAgentPayments } from "./idl/pump_agent_payments";

// Program helpers
export {
  getPumpProgram,
  OFFLINE_PUMP_PROGRAM,
  getPumpProgramWithFallback,
  getOfflineProgram,
} from "./program";

// PDA derivation
export {
  PROGRAM_ID,
  PUMP_PROGRAM_ID,
  GLOBAL_CONFIG_SEED,
  TOKEN_AGENT_PAYMENTS_SEED,
  PAYMENT_IN_CURRENCY_SEED,
  INVOICE_ID_SEED,
  BUYBACK_AUTHORITY_SEED,
  WITHDRAW_AUTHORITY_SEED,
  BONDING_CURVE_SEED,
  TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS,
  getGlobalConfigPDA,
  getTokenAgentPaymentsPDA,
  getPaymentInCurrencyPDA,
  getInvoiceIdPDA,
  getBuybackAuthorityPDA,
  getWithdrawAuthorityPDA,
  getBondingCurvePDA,
  PUMP_FEES_PROGRAM_ID,
  SHARING_CONFIG_SEED,
  getSharingConfigPDA,
} from "./pdas";

// Classes
export {
  PumpAgentOffline,
  USDC_MINT,
  decodeBondingCurveQuoteMint,
  resolveTokenProgramForMint,
} from "./PumpAgentOffline";
export { PumpAgent } from "./PumpAgent";

// Error types
export {
  CurrencyNotSupportedError,
  JupiterUnavailableError,
} from "./errors";

// Decoders
export {
  decodeGlobalConfig,
  decodeTokenAgentPaymentInCurrency,
  decodeTokenAgentPayments,
} from "./decoders";

// Types
export type {
  PumpEnvironment,
  VaultBalance,
  AgentBalances,
  CreateParams,
  WithdrawParams,
  UpdateBuybackBpsParams,
  UpdateBuybackBpsOptions,
  AcceptPaymentParams,
  AcceptPaymentSimpleParams,
  BuildAcceptPaymentParams,
  DistributePaymentsParams,
  BuybackTriggerParams,
  ExtendAccountParams,
  UpdateAuthorityParams,
  CloseAccountParams,
  GlobalConfig,
  TokenAgentPaymentInCurrency,
  TokenAgentPayments,
} from "./types";

// Convenience re-export
import { PublicKey, type Connection } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import type { PumpAgentPayments } from "./idl/pump_agent_payments";
import IDL from "./idl/pump_agent_payments.json";
import { getPumpProgram } from "./program";

export const PUMP_AGENT_PAYMENTS_PROGRAM_ID = new PublicKey(IDL.address);

export function getProgram(
  connection: Connection,
): Program<PumpAgentPayments> {
  return getPumpProgram(connection);
}

// Events
export {
  createEventParser,
  parseAgentEvents,
  subscribeToAgentEvents,
} from "./events";
export type {
  AgentAcceptPaymentEvent,
  AgentBuybackTriggerEvent,
  AgentDistributePaymentsEvent,
  AgentInitializeEvent,
  AgentUpdateAuthorityEvent,
  AgentUpdateBuybackBpsEvent,
  AgentWithdrawEvent,
  ExtendAccountEvent,
  GlobalAddNewCurrencyEvent,
  GlobalConfigInitializeEvent,
  GlobalUpdateAuthoritiesEvent,
  AgentEventName,
  AgentEventData,
  ParsedAgentEvent,
  EventSubscriptionOptions,
  EventSubscription,
} from "./events";

// solana-agent-kit plugin
export { PumpAgentPaymentsPlugin } from "./solana-agent-kit";

// x402 protocol
export * as x402 from "./x402";

// Pump bonding-curve program (`6EF8rrec...`) event parser & subscriber.
// Distinct from agent-payments events above.
export * as pumpEvents from "./pump-events.js";

// Legacy 1.0.7 program (`pUmPFn9...`) — coexists with the modern 3.0.x
// program above. Use these classes when interacting with coins whose
// tokenized agent was registered via @pump-fun/pump-sdk's
// `isTokenizedAgent: true` flag (which targets the legacy program).
export * as legacyAgentPayments from "./legacy-agent-payments/index.js";

// v2 bonding-curve trade client
export { PumpTradeClient } from "./PumpTradeClient.js";
export type {
  BuyResult,
  SellResult,
  ExactQuoteResult,
  BuyQuote,
  SellQuote,
} from "./types.js";
export {
  CoinGraduatedError,
  CoinNotFoundError,
  InsufficientLiquidityError,
  UnsupportedQuoteMintError,
} from "./PumpTradeClient.js";
