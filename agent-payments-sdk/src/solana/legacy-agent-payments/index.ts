// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

/**
 * Vendored 1.0.7 source of `@pump-fun/agent-payments-sdk` reconstructed from
 * the published npm bundle. The 1.0.7 deployment lives at program ID
 * `pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4` and is what
 * `@pump-fun/pump-sdk@1.35.0`'s `isTokenizedAgent: true` path targets.
 *
 * Coexists with the modern 3.0.x program (`AgenTMiC...`) implemented in
 * `../PumpAgent.ts` / `../PumpAgentOffline.ts`. Both can be imported and
 * used in the same process; PDAs and program IDs are disjoint.
 */
export {
  LEGACY_AGENT_PAYMENTS_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  GLOBAL_CONFIG_SEED,
  TOKEN_AGENT_PAYMENTS_SEED,
  PAYMENT_IN_CURRENCY_SEED,
  INVOICE_ID_SEED,
  BUYBACK_AUTHORITY_SEED,
  WITHDRAW_AUTHORITY_SEED,
  BONDING_CURVE_SEED,
  getGlobalConfigPDA,
  getTokenAgentPaymentsPDA,
  getPaymentInCurrencyPDA,
  getInvoiceIdPDA,
  getBuybackAuthorityPDA,
  getWithdrawAuthorityPDA,
  getBondingCurvePDA,
} from "./pdas.js";

export {
  getLegacyPumpProgram,
  getLegacyOfflineProgram,
  getLegacyPumpProgramWithFallback,
  decodeLegacyGlobalConfig,
  decodeLegacyTokenAgentPaymentInCurrency,
  decodeLegacyTokenAgentPayments,
  OFFLINE_PUMP_PROGRAM,
} from "./program.js";

export type { LegacyPumpAgentPayments } from "./idl.js";

export { LegacyPumpAgentOffline } from "./PumpAgentOffline.js";
export { LegacyPumpAgent } from "./PumpAgent.js";

export type {
  LegacyAcceptPaymentParams,
  LegacyAcceptPaymentSimpleParams,
  LegacyAgentBalances,
  LegacyBuybackTriggerParams,
  LegacyCreateParams,
  LegacyDistributePaymentsParams,
  LegacyExtendAccountParams,
  LegacyGlobalConfig,
  LegacyTokenAgentPaymentInCurrency,
  LegacyTokenAgentPayments,
  LegacyUpdateAuthorityParams,
  LegacyUpdateBuybackBpsOptions,
  LegacyUpdateBuybackBpsParams,
  LegacyVaultBalance,
  LegacyWithdrawParams,
} from "./types.js";
