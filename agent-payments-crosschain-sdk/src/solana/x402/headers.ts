/**
 * x402 v2 Header encoding / decoding
 *
 * Standard headers (per coinbase/x402 v2 spec):
 *   PAYMENT-REQUIRED   – server → client (402 response)
 *   PAYMENT-SIGNATURE  – client → server (retry request)
 *   PAYMENT-RESPONSE   – server → client (200 after settlement)
 *
 * All values are base64-encoded JSON.
 */

import type {
  PaymentPayload,
  PaymentRequired,
  PaymentResponse,
} from "./types";
import {
  X402_HEADER_PAYMENT_REQUIRED,
  X402_HEADER_PAYMENT_SIGNATURE,
  X402_HEADER_PAYMENT_RESPONSE,
} from "./types";

// ─── Encode / Decode primitives ─────────────────────────────────────────────

export function encodePaymentRequired(pr: PaymentRequired): string {
  return btoa(JSON.stringify(pr));
}

export function decodePaymentRequired(headerValue: string): PaymentRequired {
  return JSON.parse(atob(headerValue)) as PaymentRequired;
}

export function encodePaymentPayload(payload: PaymentPayload): string {
  return btoa(JSON.stringify(payload));
}

export function decodePaymentPayload(headerValue: string): PaymentPayload {
  return JSON.parse(atob(headerValue)) as PaymentPayload;
}

export function encodePaymentResponse(pr: PaymentResponse): string {
  return btoa(JSON.stringify(pr));
}

export function decodePaymentResponse(headerValue: string): PaymentResponse {
  return JSON.parse(atob(headerValue)) as PaymentResponse;
}

// ─── Request / Response helpers ─────────────────────────────────────────────

/**
 * Extract PAYMENT-REQUIRED from a 402 Response.
 * Returns null if not a 402 or header is missing.
 */
export function getPaymentRequiredFromResponse(
  response: Response,
): PaymentRequired | null {
  if (response.status !== 402) return null;
  const raw = response.headers.get(X402_HEADER_PAYMENT_REQUIRED);
  if (!raw) return null;
  return decodePaymentRequired(raw);
}

/**
 * Extract PAYMENT-SIGNATURE from a Request.
 * Returns null if header is missing.
 */
export function getPaymentPayloadFromRequest(
  request: Request,
): PaymentPayload | null {
  const raw = request.headers.get(X402_HEADER_PAYMENT_SIGNATURE);
  if (!raw) return null;
  return decodePaymentPayload(raw);
}

/**
 * Extract PAYMENT-RESPONSE from a Response.
 * Returns null if header is missing.
 */
export function getPaymentResponseFromResponse(
  response: Response,
): PaymentResponse | null {
  const raw = response.headers.get(X402_HEADER_PAYMENT_RESPONSE);
  if (!raw) return null;
  return decodePaymentResponse(raw);
}
