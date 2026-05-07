/**
 * x402 v2 – HTTP 402 Payment Required protocol for Pump Agent Payments
 *
 * Aligned with the coinbase/x402 v2 specification.
 * @see https://github.com/coinbase/x402
 *
 * Server-side:  PumpAgentFacilitator, createResourceServer, buildPumpAgentRequirements
 * Client-side:  createX402Fetch
 * Helpers:      encode/decode headers, constants
 */

// Types
export type {
  PaymentScheme,
  ExactScheme,
  PumpAgentScheme,
  ResourceInfo,
  PaymentRequirementsBase,
  ExactPaymentRequirements,
  PumpAgentPaymentRequirements,
  PaymentRequirements,
  PaymentRequired,
  PaymentPayload,
  VerifyResponse,
  SettleResponse,
  SupportedKind,
  SupportedResponse,
  FacilitatorClient,
  PaymentResponse,
  ResourceServerConfig,
  X402ClientConfig,
  TransactionSigner,
  TransactionSender,
} from "./types";
export {
  X402_VERSION,
  X402_HEADER_PAYMENT_REQUIRED,
  X402_HEADER_PAYMENT_SIGNATURE,
  X402_HEADER_PAYMENT_RESPONSE,
  SOLANA_MAINNET,
  SOLANA_DEVNET,
  USDC_MAINNET,
  USDC_DEVNET,
} from "./types";

// Headers
export {
  encodePaymentRequired,
  decodePaymentRequired,
  encodePaymentPayload,
  decodePaymentPayload,
  encodePaymentResponse,
  decodePaymentResponse,
  getPaymentRequiredFromResponse,
  getPaymentPayloadFromRequest,
  getPaymentResponseFromResponse,
} from "./headers";

// Facilitator
export type { PumpAgentFacilitatorConfig, PumpAgentRequirementsConfig } from "./facilitator";
export {
  PumpAgentFacilitator,
  buildPumpAgentRequirements,
  createResourceServer,
} from "./facilitator";

// Client
export { createX402Fetch } from "./client";
