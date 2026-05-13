// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Event Streaming Routes — SSE endpoint + Replay endpoint
// =============================================================================

import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'crypto'
import { ConnectionManager, type EventSubscriber, type EventBuffer, type EventFilter, type EventEnvelope } from 'xspace-agent'

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export interface EventRoutesConfig {
  subscriber: EventSubscriber
  buffer: EventBuffer
  connectionManager: ConnectionManager
}

export function createEventRoutes(config: EventRoutesConfig): Router {
  const router = Router()
  const { subscriber, buffer, connectionManager } = config

  // ── GET /v1/events/stream — SSE endpoint ──────────────────────────────

  router.get('/v1/events/stream', async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json({ error: 'Tenant context required' })
      return
    }

    const orgId = tenant.orgId

    // Parse filters from query string
    const filter = parseFilterFromQuery(req)

    // Register SSE connection (checks per-org limits)
    const connId = `sse_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const accepted = connectionManager.addSSE(connId, orgId, res as any)
    if (!accepted) {
      res.status(429).json({
        error: 'Too many SSE connections',
        hint: `Maximum ${connectionManager.getSSECount(orgId)} connections for this organization`,
      })
      return
    }

    // Catch-up: if client provides Last-Event-ID, replay missed events
    const lastEventId = req.headers['last-event-id'] as string | undefined
    if (lastEventId) {
      const sessionId = filter.sessions?.[0]
      const missed = buffer.replay(orgId, { sessionId, sinceEventId: lastEventId, limit: 100 })
      for (const envelope of missed) {
        connectionManager.sendEvent(
          connId,
          envelope.event.type,
          JSON.stringify(envelope.event.data),
          envelope.id,
        )
      }
    }

    // Subscribe to live events
    const subscription = await subscriber.subscribe(orgId, filter, (envelope: EventEnvelope) => {
      connectionManager.sendEvent(
        connId,
        envelope.event.type,
        JSON.stringify(envelope.event.data),
        envelope.id,
      )
    })

    // Clean up on disconnect
    req.on('close', () => {
      subscription.unsubscribe()
      connectionManager.removeSSE(connId)
    })
  })

  // ── GET /v1/events/replay — Replay missed events ─────────────────────

  router.get('/v1/events/replay', (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json({ error: 'Tenant context required' })
      return
    }

    const orgId = tenant.orgId
    const sessionId = req.query.session as string | undefined
    const sinceEventId = req.query.since as string | undefined
    const limit = Math.min(
      parseInt(req.query.limit as string, 10) || 100,
      500,
    )

    const events = buffer.replay(orgId, { sessionId, sinceEventId, limit })

    res.json({
      events,
      count: events.length,
      hasMore: events.length === limit,
    })
  })

  return router
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFilterFromQuery(req: Request): EventFilter {
  const filter: EventFilter = {}

  const events = req.query.events as string | undefined
  if (events) {
    filter.events = events.split(',').map((e) => e.trim())
  }

  const session = req.query.session as string | undefined
  if (session) {
    filter.sessions = session.split(',').map((s) => s.trim())
  }

  const agent = req.query.agent as string | undefined
  if (agent) {
    filter.agents = agent.split(',').map((a) => a.trim())
  }

  return filter
}


