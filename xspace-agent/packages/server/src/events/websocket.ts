// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Event Streaming — WebSocket (tenant-scoped rooms with event filtering)
// =============================================================================

import type { Server, Socket } from 'socket.io'
import type { EventSubscriber, EventFilter, EventEnvelope } from 'xspace-agent/dist/events'
import { EventBuffer } from 'xspace-agent/dist/events'
import { socketTenantMiddleware, getSocketTenant } from '../middleware/tenant'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export interface EventWebSocketConfig {
  io: Server
  subscriber: EventSubscriber
  buffer: EventBuffer
  /** Max concurrent WebSocket connections per org (default 50). */
  maxPerOrg?: number
}

interface SocketSubscription {
  unsubscribe(): void
}

/**
 * Set up the `/events` Socket.IO namespace for real-time event streaming.
 *
 * Tenant isolation: each socket is authenticated via tenant middleware,
 * and automatically joins an org-scoped room. Subscriptions are scoped
 * to the authenticated org.
 */
export function setupEventWebSocket(config: EventWebSocketConfig): void {
  const { io, subscriber, buffer, maxPerOrg = 50 } = config

  const eventsNS = io.of('/events')
  const orgConnectionCounts = new Map<string, number>()
  const socketSubscriptions = new Map<string, SocketSubscription[]>()

  // Apply tenant middleware
  eventsNS.use(socketTenantMiddleware())

  eventsNS.on('connection', (socket: Socket) => {
    const tenant = getSocketTenant(socket)
    const orgId = tenant.orgId

    // Enforce connection limit
    const count = orgConnectionCounts.get(orgId) ?? 0
    if (count >= maxPerOrg) {
      socket.emit('error', { message: 'Too many connections for this organization' })
      socket.disconnect(true)
      return
    }
    orgConnectionCounts.set(orgId, count + 1)

    // Join org room
    socket.join(`org:${orgId}`)

    // Track subscriptions for this socket
    socketSubscriptions.set(socket.id, [])

    // --- Subscribe to event streams ---
    socket.on('subscribe', async (filters: EventFilter, ack?: (resp: { ok: boolean; subscriptionId?: string; error?: string }) => void) => {
      try {
        const subscription = await subscriber.subscribe(orgId, filters, (envelope: EventEnvelope) => {
          socket.emit('event', envelope)
        })

        const subs = socketSubscriptions.get(socket.id)
        if (subs) {
          subs.push(subscription)
        }

        ack?.({ ok: true, subscriptionId: subscription.id })
      } catch (err: any) {
        ack?.({ ok: false, error: err.message })
      }
    })

    // --- Unsubscribe from event streams ---
    socket.on('unsubscribe', async (filters: EventFilter, ack?: (resp: { ok: boolean }) => void) => {
      // Unsubscribe all subscriptions for this socket (simplified — in production
      // you'd match by subscription ID)
      const subs = socketSubscriptions.get(socket.id) ?? []
      for (const sub of subs) {
        sub.unsubscribe()
      }
      socketSubscriptions.set(socket.id, [])
      ack?.({ ok: true })
    })

    // --- Replay missed events ---
    socket.on('replay', (opts: { sessionId?: string; sinceEventId?: string; limit?: number }, ack?: (events: EventEnvelope[]) => void) => {
      const events = buffer.replay(orgId, {
        sessionId: opts.sessionId,
        sinceEventId: opts.sinceEventId,
        limit: Math.min(opts.limit ?? 100, 500),
      })
      ack?.(events)
    })

    // --- Cleanup on disconnect ---
    socket.on('disconnect', () => {
      // Clean up subscriptions
      const subs = socketSubscriptions.get(socket.id) ?? []
      for (const sub of subs) {
        sub.unsubscribe()
      }
      socketSubscriptions.delete(socket.id)

      // Decrement org count
      const currentCount = orgConnectionCounts.get(orgId) ?? 0
      if (currentCount <= 1) {
        orgConnectionCounts.delete(orgId)
      } else {
        orgConnectionCounts.set(orgId, currentCount - 1)
      }
    })
  })
}


