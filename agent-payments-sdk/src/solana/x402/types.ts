// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

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

/**
 * Standard x402 header names (Coinbase v2 wire spec).
 *
 *   X-PAYMENT          – client → server, retry request with payment proof
 *   X-PAYMENT-RESPONSE – server → client, settlement receipt on the success reply
 *
 * The 402 response carries the PaymentRequired struct in the response **body**
 * (`application/json`). Some servers also expose it base64-encoded as the
 * `payment-required` response header for header-only inspection by Bazaar
 * crawlers — read the body first, fall back to the header.
 */
export const X402_HEADER_PAYMENT = "X-PAYMENT";
export const X402_HEADER_PAYMENT_RESPONSE = "X-PAYMENT-RESPONSE";
export const X402_HEADER_PAYMENT_REQUIRED = "payment-required";

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
  /** MIME type of the response body (required on PaymentPayload.resource by PayAI) */
  mimeType?: string;
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
  /** Per-spec extension envelope keyed by extension name. */
  extensions?: Record<string, unknown>;
}

// ─── auth-hints extension (server → client) ─────────────────────────────────
//
// Spec: /tmp/x402-docs/specs/extensions/extension-auth-hints.md
//
// When a 402 response contains an `auth-hints` extension, certain accepts[]
// entries are gated by authentication rather than (or in addition to)
// payment. The client picks an auth method it can satisfy, attaches the
// matching header on the retry, and skips the X-PAYMENT dance entirely.

export type AuthHintsMethod =
  | { type: "oauth2"; tokenType?: "Bearer" | "DPoP"; authorizationServer?: string; tokenEndpoint?: string; registrationEndpoint?: string }
  | { type: "sign-in-with-x" };

export interface AuthHintsRequirement {
  acceptIndexes: number[];
  methods: AuthHintsMethod[];
}

export interface AuthHintsExtension {
  info: { authRequirements: AuthHintsRequirement[] };
  schema?: Record<string, unknown>;
}

/** Headers a buyer can attach to satisfy an `auth-hints` requirement. */
export interface AuthHintsCredentials {
  /** Pre-fetched OAuth 2.0 access token. Sent as `Authorization: Bearer …`. */
  oauth2AccessToken?: string;
  /** Base64-encoded SIGN-IN-WITH-X header value. The client must produce a
   *  CAIP-122 message + signature itself (or via the sign-in-with-x extension)
   *  before invoking the request. */
  siwxHeader?: string;
}

// ─── Payment Payload (client → server proof in X-PAYMENT header) ───────────

export interface PaymentPayload {
  x402Version: 2;
  /** Payment scheme (matches one of the `accepts[]` entries) */
  scheme: PaymentScheme;
  /** CAIP-2 network identifier (matches the chosen `accepts[]` entry) */
  network: string;
  /** The resource this payment is for — PayAI's facilitator requires the
   *  ResourceInfo object shape (bare string is rejected as invalid_payload). */
  resource?: ResourceInfo;
  /** Which accepted scheme/requirements this payment matches (full entry) */
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

// ─── Payment Response (server → client via X-PAYMENT-RESPONSE header) ──────

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
  /**
   * Default payment requirements for this resource.
   *
   * For the `pump-agent` scheme the resource server mints a FRESH invoice
   * (new memo + validity window) per 402 response so each payment is bound to
   * a single, single-use invoice — these entries act as the template for amount
   * / asset / agentMint / payTo, not as a reusable static invoice. Provide
   * {@link mintRequirements} to fully control per-request invoice generation.
   */
  requirements: PaymentRequirements[];
  /** Resource info describing what's for sale */
  resource: ResourceInfo;
  /**
   * Optional factory invoked on every 402 to mint fresh, per-request payment
   * requirements (e.g. via `buildPumpAgentRequirements`). When omitted, the
   * server regenerates the invoice fields (memo/startTime/endTime) of any
   * `pump-agent` entry in {@link requirements} for each 402. Supplying this lets
   * you vary price/asset per request or add per-caller invoice metadata.
   */
  mintRequirements?: (
    request: Request,
  ) => PaymentRequirements[] | Promise<PaymentRequirements[]>;
  /**
   * Server secret that binds every `pump-agent` invoice to this server. Memos are
   * minted as an HMAC-tagged u64 and the resource server refuses an echoed
   * invoice whose memo it did not mint for those exact fields, or whose window is
   * closed, before any on-chain check. Strongly recommended in production; when
   * you supply {@link mintRequirements}, mint with `buildPumpAgentRequirements`
   * and the same `invoiceSecret`.
   */
  invoiceSecret?: string;
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
  /**
   * auth-hints handler. When the server's 402 includes an `auth-hints`
   * extension, the client invokes this callback with the offered methods so
   * the caller can attach OAuth2 / SIWX credentials and bypass payment.
   *
   * Return value semantics:
   *   • `AuthHintsCredentials` with at least one filled field → the wrapper
   *     retries with the matching header and returns the response.
   *   • `null` / `undefined`                                  → fall through
   *     to the regular payment flow (sign + pay).
   *
   * If the callback throws or returns nothing, the wrapper proceeds with
   * payment instead — auth-hints are advisory, not mandatory.
   */
  onAuthRequired?: (ctx: {
    extension: AuthHintsExtension;
    accepts: PaymentRequirements[];
    resource: ResourceInfo;
  }) => Promise<AuthHintsCredentials | null | undefined> | AuthHintsCredentials | null | undefined;
}
