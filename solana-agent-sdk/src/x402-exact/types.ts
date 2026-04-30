/** Re-usable subset of x402 v2 types for the "exact" scheme. */

export interface ExactPaymentRequirements {
  scheme: "exact";
  network: string;
  /** SPL token mint address (base58) */
  asset: string;
  /** Amount in token base units (string) */
  amount: string;
  /** Recipient wallet address (base58) */
  payTo: string;
  /** Max seconds to wait for settlement */
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface ExactPaymentProof {
  /** Confirmed transaction signature (base58) */
  signature: string;
  /** CAIP-2 network identifier */
  network: string;
}

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

/** Well-known CAIP-2 identifiers */
export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

/** USDC mint addresses */
export const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
