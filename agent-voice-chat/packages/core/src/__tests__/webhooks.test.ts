// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§85]

// =============================================================================
// Webhooks — Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  signPayload,
  verifySignature,
  generateWebhookSecret,
  generateEventId,
} from '../webhooks/signing'
import {
  WEBHOOK_EVENTS,
  DEFAULT_RETRY_CONFIG,
  type WebhookPayload,
  type WebhookEventType,
} from '../webhooks/types'
import { WebhookDeliveryService } from '../webhooks/delivery'

// =============================================================================
// Signing
// =============================================================================

describe('Webhook Signing', () => {
  const secret = 'whsec_test_secret_key'
  const timestamp = 1700000000
  const payload = {
    id: 'evt_abc123',
    type: 'agent.created' as const,
    created: timestamp,
    data: { object: { id: 'agt_123', name: 'Test' } },
    org_id: 'org_123',
    api_version: '2024-01-15',
  }

  it('should produce a sha256-prefixed signature', () => {
    const sig = signPayload(payload, secret, timestamp)
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/)
  })

  it('should produce deterministic signatures', () => {
    const sig1 = signPayload(payload, secret, timestamp)
    const sig2 = signPayload(payload, secret, timestamp)
    expect(sig1).toBe(sig2)
  })

  it('should produce different signatures for different secrets', () => {
    const sig1 = signPayload(payload, 'secret_a', timestamp)
    const sig2 = signPayload(payload, 'secret_b', timestamp)
    expect(sig1).not.toBe(sig2)
  })

  it('should produce different signatures for different timestamps', () => {
    const sig1 = signPayload(payload, secret, 1000)
    const sig2 = signPayload(payload, secret, 2000)
    expect(sig1).not.toBe(sig2)
  })

  it('should verify a valid signature', () => {
    const sig = signPayload(payload, secret, timestamp)
    expect(verifySignature(payload, sig, timestamp, secret)).toBe(true)
  })

  it('should reject an invalid signature', () => {
    expect(verifySignature(payload, 'sha256=invalid', timestamp, secret)).toBe(false)
  })

  it('should reject a signature with wrong secret', () => {
    const sig = signPayload(payload, secret, timestamp)
    expect(verifySignature(payload, sig, timestamp, 'wrong_secret')).toBe(false)
  })

  it('should reject a signature with wrong timestamp (replay protection)', () => {
    const sig = signPayload(payload, secret, timestamp)
    expect(verifySignature(payload, sig, timestamp + 1, secret)).toBe(false)
  })

  it('should reject signatures of different lengths', () => {
    expect(verifySignature(payload, 'sha256=short', timestamp, secret)).toBe(false)
  })
})

describe('Webhook Secret Generation', () => {
  it('should generate a whsec_ prefixed secret', () => {
    const secret = generateWebhookSecret()
    expect(secret).toMatch(/^whsec_[a-f0-9]{64}$/)
  })

  it('should generate unique secrets', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateWebhookSecret()))
    expect(secrets.size).toBe(50)
  })
})

describe('Event ID Generation', () => {
  it('should generate an evt_ prefixed ID', () => {
    const id = generateEventId()
    expect(id).toMatch(/^evt_[a-f0-9]{32}$/)
  })

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateEventId()))
    expect(ids.size).toBe(50)
  })
})

// =============================================================================
// Event Types
// =============================================================================

describe('Webhook Event Types', () => {
  it('should define 20+ event types', () => {
    const eventCount = Object.keys(WEBHOOK_EVENTS).length
    expect(eventCount).toBeGreaterThanOrEqual(20)
  })

  it('should have descriptions for all events', () => {
    for (const [key, desc] of Object.entries(WEBHOOK_EVENTS)) {
      expect(desc).toBeTruthy()
      expect(typeof desc).toBe('string')
    }
  })

  it('should cover agent lifecycle events', () => {
    expect(WEBHOOK_EVENTS['agent.created']).toBeDefined()
    expect(WEBHOOK_EVENTS['agent.updated']).toBeDefined()
    expect(WEBHOOK_EVENTS['agent.deleted']).toBeDefined()
  })

  it('should cover session lifecycle events', () => {
    expect(WEBHOOK_EVENTS['session.started']).toBeDefined()
    expect(WEBHOOK_EVENTS['session.ended']).toBeDefined()
    expect(WEBHOOK_EVENTS['session.error']).toBeDefined()
  })

  it('should cover billing events', () => {
    expect(WEBHOOK_EVENTS['usage.threshold']).toBeDefined()
    expect(WEBHOOK_EVENTS['invoice.created']).toBeDefined()
    expect(WEBHOOK_EVENTS['invoice.paid']).toBeDefined()
    expect(WEBHOOK_EVENTS['invoice.failed']).toBeDefined()
  })

  it('should cover security events', () => {
    expect(WEBHOOK_EVENTS['security.api_key_used']).toBeDefined()
    expect(WEBHOOK_EVENTS['security.login_anomaly']).toBeDefined()
  })
})

// =============================================================================
// Retry Config
// =============================================================================

describe('Retry Configuration', () => {
  it('should have 7 max attempts', () => {
    expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(7)
  })

  it('should have 7 backoff delays matching the attempts', () => {
    expect(DEFAULT_RETRY_CONFIG.backoffDelaysMs).toHaveLength(7)
  })

  it('should have increasing backoff delays', () => {
    const delays = DEFAULT_RETRY_CONFIG.backoffDelaysMs
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1])
    }
  })

  it('should start with immediate delivery (0ms)', () => {
    expect(DEFAULT_RETRY_CONFIG.backoffDelaysMs[0]).toBe(0)
  })

  it('should end with 24-hour delay', () => {
    const last = DEFAULT_RETRY_CONFIG.backoffDelaysMs[DEFAULT_RETRY_CONFIG.backoffDelaysMs.length - 1]
    expect(last).toBe(86_400_000)
  })

  it('should auto-disable after 3 consecutive exhausted deliveries', () => {
    expect(DEFAULT_RETRY_CONFIG.autoDisableThreshold).toBe(3)
  })
})

// =============================================================================
// WebhookDeliveryService (unit tests with mocked repos)
// =============================================================================

describe('WebhookDeliveryService', () => {
  let service: WebhookDeliveryService

  beforeEach(() => {
    service = new WebhookDeliveryService({
      requestTimeoutMs: 5000,
      retryPollIntervalMs: 60_000,
    })
  })

  afterEach(() => {
    service.stop()
  })

  it('should be constructable with default options', () => {
    const s = new WebhookDeliveryService()
    expect(s).toBeInstanceOf(WebhookDeliveryService)
    s.stop()
  })

  it('should accept custom retry config', () => {
    const s = new WebhookDeliveryService({
      retryConfig: { maxAttempts: 3 },
    })
    expect(s).toBeInstanceOf(WebhookDeliveryService)
    s.stop()
  })

  it('should start and stop the retry loop without errors', () => {
    service.start()
    service.start() // idempotent
    service.stop()
    service.stop() // idempotent
  })

  it('should emit events (EventEmitter inheritance)', () => {
    const handler = vi.fn()
    service.on('delivered', handler)
    service.emit('delivered', { deliveryId: '123', webhookId: '456' })
    expect(handler).toHaveBeenCalledWith({ deliveryId: '123', webhookId: '456' })
  })
})

// =============================================================================
// Payload Format
// =============================================================================

describe('Webhook Payload Format', () => {
  it('should match the expected structure', () => {
    const payload: WebhookPayload = {
      id: 'evt_abc123',
      type: 'session.started',
      created: 1616450000,
      data: {
        object: {
          id: 'ses_xyz789',
          agent_id: 'agt_def456',
          space_url: 'https://x.com/i/spaces/test',
          platform: 'x-spaces',
          started_at: '2024-01-15T10:30:00Z',
        },
      },
      org_id: 'org_abc123',
      api_version: '2024-01-15',
    }

    expect(payload.id).toMatch(/^evt_/)
    expect(payload.type).toBe('session.started')
    expect(payload.created).toBeTypeOf('number')
    expect(payload.data.object).toBeDefined()
    expect(payload.org_id).toBeDefined()
    expect(payload.api_version).toBeDefined()
  })
})

// =============================================================================
// Customer-side Verification Round-trip
// =============================================================================

describe('Signature Verification Round-trip', () => {
  it('should allow customer code to verify webhook signatures', () => {
    const secret = generateWebhookSecret()
    const timestamp = Math.floor(Date.now() / 1000)
    const payload: WebhookPayload = {
      id: generateEventId(),
      type: 'agent.created',
      created: timestamp,
      data: { object: { id: 'agt_123' } },
      org_id: 'org_test',
      api_version: '2024-01-15',
    }

    // Server side: sign
    const signature = signPayload(payload, secret, timestamp)

    // Customer side: verify using the documented approach
    const { createHmac } = require('crypto')
    const signedPayload = `${timestamp}.${JSON.stringify(payload)}`
    const expected = createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex')

    expect(signature).toBe(`sha256=${expected}`)
    expect(verifySignature(payload, signature, timestamp, secret)).toBe(true)
  })
})


