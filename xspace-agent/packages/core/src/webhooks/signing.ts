// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// =============================================================================
// Webhooks — HMAC-SHA256 Signing & Verification
// =============================================================================

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * Sign a webhook payload using HMAC-SHA256.
 *
 * The signed content is `${timestamp}.${JSON.stringify(payload)}` to prevent
 * replay attacks (timestamp is bound into the signature).
 */
export function signPayload(payload: unknown, secret: string, timestamp: number): string {
  const signedContent = `${timestamp}.${JSON.stringify(payload)}`
  const hmac = createHmac('sha256', secret).update(signedContent).digest('hex')
  return `sha256=${hmac}`
}

/**
 * Verify a webhook signature. Uses timing-safe comparison to prevent timing attacks.
 */
export function verifySignature(
  payload: unknown,
  signature: string,
  timestamp: number,
  secret: string,
): boolean {
  const expected = signPayload(payload, secret, timestamp)
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

/** Generate a cryptographically secure webhook secret. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('hex')}`
}

/** Generate a prefixed event ID. */
export function generateEventId(): string {
  return `evt_${randomBytes(16).toString('hex')}`
}


