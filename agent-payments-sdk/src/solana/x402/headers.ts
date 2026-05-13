// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

/**
 * x402 v2 wire encoding / decoding.
 *
 * Coinbase x402 v2 wire format:
 *   - Request:        `X-PAYMENT: <base64(JSON PaymentPayload)>`
 *   - 402 response:   PaymentRequired struct as `application/json` body;
 *                     mirrored as base64 in the `payment-required` header for
 *                     header-only inspection (Bazaar crawlers).
 *   - Settled reply:  `X-PAYMENT-RESPONSE: <base64(JSON PaymentResponse)>`
 *
 * All header values are base64-encoded JSON.
 */

import type {
  PaymentPayload,
  PaymentRequired,
  PaymentResponse,
} from "./types";
import {
  X402_HEADER_PAYMENT,
  X402_HEADER_PAYMENT_REQUIRED,
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
 * Extract PaymentRequired from a 402 Response.
 *
 * v2 servers carry the struct in the JSON body; some also mirror it as a
 * base64 `payment-required` header. Reads body first, falls back to the
 * header for header-only inspection paths. Returns null when not a 402 or
 * neither location is parseable.
 *
 * The response body is consumed when this returns a body-decoded result —
 * callers needing the raw response stream should pass a cloned Response.
 */
export async function getPaymentRequiredFromResponse(
  response: Response,
): Promise<PaymentRequired | null> {
  if (response.status !== 402) return null;
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    try {
      return (await response.clone().json()) as PaymentRequired;
    } catch {
      // fall through to header
    }
  }
  const raw = response.headers.get(X402_HEADER_PAYMENT_REQUIRED);
  if (!raw) return null;
  try {
    return decodePaymentRequired(raw);
  } catch {
    return null;
  }
}

/**
 * Extract the X-PAYMENT payload from a Request.
 * Returns null if header is missing.
 */
export function getPaymentPayloadFromRequest(
  request: Request,
): PaymentPayload | null {
  const raw = request.headers.get(X402_HEADER_PAYMENT);
  if (!raw) return null;
  return decodePaymentPayload(raw);
}

/**
 * Extract X-PAYMENT-RESPONSE from a Response.
 * Returns null if header is missing.
 */
export function getPaymentResponseFromResponse(
  response: Response,
): PaymentResponse | null {
  const raw = response.headers.get(X402_HEADER_PAYMENT_RESPONSE);
  if (!raw) return null;
  return decodePaymentResponse(raw);
}
