/**
 * x402 v2 Protocol Types
 *
 * Aligned with the coinbase/x402 specification.
 * Supports "pump-agent" scheme (on-chain invoice payments) and
 * the standard "exact" scheme (SPL TransferChecked).
 *
 * @see https://github.com/coinbase/x402
 */

// ─── Protocol Constants ─────────────────────────────────────────────────────

export const X402_VERSION = 2;

/** Standard x402 header names (v2 spec) */
export const X402_HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
export const X402_HEADER_PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
export const X402_HEADER_PAYMENT_RESPONSE = "PAYMENT-RESPONSE";

/** CAIP-2 network identifiers for Solana */
export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

/** Well-known Solana asset addresses */
export const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// ─── Scheme types ───────────────────────────────────────────────────────────

/** Standard x402 "exact" scheme – SPL TransferChecked */
export type ExactScheme = "exact";
/** Pump Agent invoice scheme */
export type PumpAgentScheme = "pump-agent";
/** Supported payment schemes */
export type PaymentScheme = ExactScheme | PumpAgentScheme;

// ─── Resource Info (server describes what is being sold) ────────────────────

export interface ResourceInfo {
  /** The URL of the paid resource */
  url: string;
  /** Human-readable description */
  description?: string;
}

// ─── Payment Requirements (per-scheme offer in 402 body) ────────────────────

/** Base fields shared by all schemes */
export interface PaymentRequirementsBase {
  /** Payment scheme identifier */
  scheme: PaymentScheme;
  /** CAIP-2 network identifier */
  network: string;
  /** Token/asset mint address (base58) */
  asset: string;
  /** Amount in minor units (string to avoid floating point) */
  amount: string;
  /** Recipient address (base58) */
  payTo: string;
  /** Max seconds the facilitator will wait for settlement */
  maxTimeoutSeconds: number;
  /** Scheme-specific extra data */
  extra?: Record<string, unknown>;
}

/** "exact" scheme – standard SPL TransferChecked */
export interface ExactPaymentRequirements extends PaymentRequirementsBase {
  scheme: "exact";
}

/** "pump-agent" scheme – Pump Agent on-chain invoice */
export interface PumpAgentPaymentRequirements extends PaymentRequirementsBase {
  scheme: "pump-agent";
  extra: {
    /** Agent token mint (base58) */
    agentMint: string;
    /** Numeric invoice memo */
    memo: string;
    /** Unix timestamp – invoice valid from */
    startTime: number;
    /** Unix timestamp – invoice valid until */
    endTime: number;
  };
}

/** Union of all supported requirements */
export type PaymentRequirements =
  | ExactPaymentRequirements
  | PumpAgentPaymentRequirements;

// ─── Payment Required (402 response body) ───────────────────────────────────

export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
}

// ─── Payment Payload (client → server proof in PAYMENT-SIGNATURE) ───────────

export interface PaymentPayload {
  x402Version: 2;
  /** The resource URL this payment is for */
  resource?: string;
  /** Which accepted scheme/requirements this payment matches */
  accepted: PaymentRequirements;
  /** Scheme-specific proof data */
  payload: Record<string, unknown>;
}

// ─── Facilitator Responses ──────────────────────────────────────────────────

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction?: string;
  network?: string;
}

export interface SupportedKind {
  scheme: PaymentScheme;
  network: string;
  asset: string;
}

export interface SupportedResponse {
  kinds: SupportedKind[];
}

// ─── Facilitator Client Interface ───────────────────────────────────────────

export interface FacilitatorClient {
  /** Verify a payment payload against its requirements */
  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse>;

  /** Settle (submit) a verified payment and return the result */
  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse>;

  /** Return the schemes/networks/assets this facilitator supports */
  getSupported(): Promise<SupportedResponse>;
}

// ─── Payment Response (server → client via PAYMENT-RESPONSE header) ─────────

export interface PaymentResponse {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
}

// ─── Server / Middleware Configuration ───────────────────────────────────────

export interface ResourceServerConfig {
  /** Facilitator client to use for verify + settle */
  facilitator: FacilitatorClient;
  /** Default payment requirements for this resource */
  requirements: PaymentRequirements[];
  /** Resource info describing what's for sale */
  resource: ResourceInfo;
}

// ─── Client Configuration ───────────────────────────────────────────────────

export type TransactionSigner = (txBase64: string) => Promise<string>;
export type TransactionSender = (signedTxBase64: string) => Promise<string>;

export interface X402ClientConfig {
  /** Payer's public key (base58) */
  payer: string;
  /** Sign a serialised transaction, return signed base64 */
  signTransaction: TransactionSigner;
  /** Send a signed transaction, return the tx signature (base58) */
  sendTransaction: TransactionSender;
  /** CAIP-2 network identifier (default: SOLANA_MAINNET) */
  network?: string;
  /** Max time to wait for tx confirmation in ms (default: 30_000) */
  confirmationTimeoutMs?: number;
}
