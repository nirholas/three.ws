// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§70]

// =============================================================================
// Webhooks — Event Types and Payload Definitions
// =============================================================================

/** All supported webhook event types. */
export const WEBHOOK_EVENTS = {
  // Agent lifecycle
  'agent.created': 'Agent configuration created',
  'agent.updated': 'Agent configuration updated',
  'agent.deleted': 'Agent configuration deleted',

  // Session lifecycle
  'session.started': 'Agent session started (joined Space)',
  'session.ended': 'Agent session ended',
  'session.error': 'Agent session encountered an error',

  // Real-time events
  'transcription.received': 'New transcription from Space',
  'response.generated': 'Agent generated a response',
  'response.spoken': 'Agent spoke in Space',

  // Team events
  'team.handoff': 'Agent handed off to another agent',
  'team.interruption': 'Agent was interrupted',

  // Conversation events
  'conversation.created': 'New conversation started',
  'conversation.completed': 'Conversation ended with summary',

  // Billing events
  'usage.threshold': 'Usage threshold reached (50%, 75%, 90%, 100%)',
  'invoice.created': 'New invoice generated',
  'invoice.paid': 'Invoice payment succeeded',
  'invoice.failed': 'Invoice payment failed',

  // Security events
  'security.api_key_used': 'API key used from new IP',
  'security.login_anomaly': 'Login from new device/location',

  // Webhook lifecycle
  'webhook.disabled': 'Webhook auto-disabled due to repeated failures',
} as const

export type WebhookEventType = keyof typeof WEBHOOK_EVENTS

/** Webhook payload envelope sent to customer endpoints. */
export interface WebhookPayload {
  /** Event ID (prefixed with evt_). */
  id: string
  /** Event type. */
  type: WebhookEventType
  /** Unix timestamp of event creation. */
  created: number
  /** Event-specific data. */
  data: {
    object: Record<string, unknown>
  }
  /** Organization that owns this event. */
  org_id: string
  /** API version that generated this event. */
  api_version: string
}

/** Delivery status for a webhook attempt. */
export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'exhausted'

/** Configuration for retry behavior. */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 7). */
  maxAttempts: number
  /** Backoff delays in milliseconds for each retry attempt. */
  backoffDelaysMs: number[]
  /** Number of consecutive exhausted deliveries before auto-disabling (default: 3). */
  autoDisableThreshold: number
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 7,
  backoffDelaysMs: [
    0,              // Attempt 1: immediate
    60_000,         // Attempt 2: 1 minute
    300_000,        // Attempt 3: 5 minutes
    1_800_000,      // Attempt 4: 30 minutes
    7_200_000,      // Attempt 5: 2 hours
    28_800_000,     // Attempt 6: 8 hours
    86_400_000,     // Attempt 7: 24 hours
  ],
  autoDisableThreshold: 3,
}

/** Headers sent with every webhook delivery. */
export interface WebhookDeliveryHeaders {
  'X-Webhook-Id': string
  'X-Webhook-Timestamp': string
  'X-Webhook-Signature': string
  'Content-Type': 'application/json'
  'User-Agent': 'XSpaceAgent-Webhook/1.0'
  [key: string]: string
}

/** Result of a single delivery attempt. */
export interface DeliveryAttemptResult {
  success: boolean
  statusCode?: number
  responseBody?: string
  durationMs: number
  error?: string
}


