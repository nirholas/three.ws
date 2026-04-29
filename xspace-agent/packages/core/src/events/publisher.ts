// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Event Streaming — Publisher (Redis Pub/Sub)
// =============================================================================

import { randomUUID } from 'crypto'
import type Redis from 'ioredis'
import type { StreamEvent, EventEnvelope } from './types'

/**
 * Publishes stream events to Redis Pub/Sub channels with tenant isolation.
 *
 * Channel naming:
 *   - `xsevents:{orgId}`                         — all events for an org
 *   - `xsevents:{orgId}:session:{sessionId}`     — session-specific events
 */
export class EventPublisher {
  constructor(private readonly redis: Redis) {}

  /**
   * Publish a stream event for a given org.
   * Publishes to both the org-level and (when applicable) session-level channels.
   */
  async publish(orgId: string, event: StreamEvent): Promise<EventEnvelope> {
    const envelope: EventEnvelope = {
      id: `evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      timestamp: new Date().toISOString(),
      orgId,
      event,
    }

    const payload = JSON.stringify(envelope)
    const orgChannel = `xsevents:${orgId}`

    // Publish to org channel
    await this.redis.publish(orgChannel, payload)

    // Also publish to session-specific channel if the event data contains a sessionId
    const data = event.data as Record<string, unknown>
    if (typeof data.sessionId === 'string') {
      const sessionChannel = `xsevents:${orgId}:session:${data.sessionId}`
      await this.redis.publish(sessionChannel, payload)
    }

    return envelope
  }
}


