// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// =============================================================================
// Event Streaming — Subscriber (Redis Pub/Sub with filtering)
// =============================================================================

import { randomUUID } from 'crypto'
import Redis from 'ioredis'
import type { EventEnvelope, EventFilter, Subscription } from './types'

/**
 * Match a value against a glob pattern (supports `*` as wildcard segment).
 * Examples:
 *   matchGlob('transcription.*', 'transcription.chunk') → true
 *   matchGlob('*.error', 'agent.error') → true
 *   matchGlob('response.generated', 'response.generated') → true
 */
export function matchGlob(pattern: string, value: string): boolean {
  // Escape regex-special chars except `*`
  const re = pattern
    .replace(/([.+?^${}()|[\]\\])/g, '\\$1')
    .replace(/\*/g, '[^.]*')
  return new RegExp(`^${re}$`).test(value)
}

/** Check whether an envelope passes the given filter. */
export function matchesFilter(envelope: EventEnvelope, filter: EventFilter): boolean {
  const { event } = envelope

  // Event type filter
  if (filter.events && filter.events.length > 0) {
    const matched = filter.events.some((pattern) => matchGlob(pattern, event.type))
    if (!matched) return false
  }

  const data = event.data as Record<string, unknown>

  // Session filter
  if (filter.sessions && filter.sessions.length > 0) {
    const sessionId = data.sessionId as string | undefined
    if (!sessionId || !filter.sessions.includes(sessionId)) return false
  }

  // Agent filter
  if (filter.agents && filter.agents.length > 0) {
    const agentId = data.agentId as string | undefined
    if (!agentId || !filter.agents.includes(agentId)) return false
  }

  return true
}

interface ActiveSubscription {
  id: string
  orgId: string
  filters: EventFilter
  callback: (envelope: EventEnvelope) => void
}

/**
 * Subscribes to Redis Pub/Sub channels and delivers filtered events to callbacks.
 *
 * One subscriber Redis connection is created per EventSubscriber instance
 * (ioredis requires a dedicated connection for subscribe mode).
 */
export class EventSubscriber {
  private subRedis: Redis
  private subscriptions = new Map<string, ActiveSubscription>()
  /** Track which Redis channels we're subscribed to, with ref counts. */
  private channelRefs = new Map<string, number>()
  private closed = false

  constructor(redisOptions: Record<string, unknown>) {
    // Dedicated connection for subscribe mode
    this.subRedis = new Redis(redisOptions as any)
    this.subRedis.on('error', (err) => {
      console.error('[EventSubscriber] Redis error', err.message)
    })

    this.subRedis.on('message', (channel: string, message: string) => {
      this.handleMessage(channel, message)
    })
  }

  /**
   * Subscribe to events for a given org, with optional filters.
   * Returns a Subscription handle that can be used to unsubscribe.
   */
  async subscribe(
    orgId: string,
    filters: EventFilter,
    callback: (envelope: EventEnvelope) => void,
  ): Promise<Subscription> {
    if (this.closed) throw new Error('EventSubscriber is closed')

    const id = `sub_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const sub: ActiveSubscription = { id, orgId, filters, callback }
    this.subscriptions.set(id, sub)

    // Subscribe to the org channel
    const orgChannel = `xsevents:${orgId}`
    await this.ensureChannel(orgChannel)

    // If filtering to specific sessions, also subscribe to session channels
    if (filters.sessions && filters.sessions.length > 0) {
      for (const sessionId of filters.sessions) {
        await this.ensureChannel(`xsevents:${orgId}:session:${sessionId}`)
      }
    }

    return {
      id,
      orgId,
      filters,
      unsubscribe: () => this.unsubscribe(id),
    }
  }

  /** Remove a subscription. Unsubscribes from Redis channels when no longer needed. */
  async unsubscribe(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId)
    if (!sub) return

    this.subscriptions.delete(subscriptionId)

    const orgChannel = `xsevents:${sub.orgId}`
    await this.releaseChannel(orgChannel)

    if (sub.filters.sessions) {
      for (const sessionId of sub.filters.sessions) {
        await this.releaseChannel(`xsevents:${sub.orgId}:session:${sessionId}`)
      }
    }
  }

  /** Close the subscriber and all Redis connections. */
  async close(): Promise<void> {
    this.closed = true
    this.subscriptions.clear()
    this.channelRefs.clear()
    await this.subRedis.quit()
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private handleMessage(_channel: string, message: string): void {
    let envelope: EventEnvelope
    try {
      envelope = JSON.parse(message) as EventEnvelope
    } catch {
      return // ignore malformed messages
    }

    for (const sub of this.subscriptions.values()) {
      if (sub.orgId !== envelope.orgId) continue
      if (matchesFilter(envelope, sub.filters)) {
        try {
          sub.callback(envelope)
        } catch {
          // Don't let a bad callback break other subscriptions
        }
      }
    }
  }

  private async ensureChannel(channel: string): Promise<void> {
    const current = this.channelRefs.get(channel) ?? 0
    this.channelRefs.set(channel, current + 1)
    if (current === 0) {
      await this.subRedis.subscribe(channel)
    }
  }

  private async releaseChannel(channel: string): Promise<void> {
    const current = this.channelRefs.get(channel) ?? 0
    if (current <= 1) {
      this.channelRefs.delete(channel)
      // Only unsubscribe if no other subscriptions need this channel
      const stillNeeded = Array.from(this.subscriptions.values()).some((s) => {
        const orgCh = `xsevents:${s.orgId}`
        if (channel === orgCh) return true
        if (s.filters.sessions) {
          return s.filters.sessions.some(
            (sid) => `xsevents:${s.orgId}:session:${sid}` === channel,
          )
        }
        return false
      })
      if (!stillNeeded) {
        await this.subRedis.unsubscribe(channel)
      }
    } else {
      this.channelRefs.set(channel, current - 1)
    }
  }
}


