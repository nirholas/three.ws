// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// =============================================================================
// Tests — Event Streaming Routes (createEventRoutes)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp, createMockTenant } from '../helpers/test-app'
import { createEventRoutes } from '../../src/routes/events'

// ---------------------------------------------------------------------------
// Mock xspace-agent/dist/events imports
// ---------------------------------------------------------------------------

vi.mock('xspace-agent/dist/events', () => ({
  ConnectionManager: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

function createMockSubscriber() {
  return {
    subscribe: vi.fn().mockResolvedValue({
      unsubscribe: vi.fn(),
    }),
  }
}

function createMockBuffer() {
  return {
    replay: vi.fn().mockReturnValue([]),
  }
}

function createMockConnectionManager() {
  return {
    addSSE: vi.fn().mockReturnValue(true),
    removeSSE: vi.fn(),
    sendEvent: vi.fn(),
    getSSECount: vi.fn().mockReturnValue(5),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(opts?: { tenant?: ReturnType<typeof createMockTenant> | null }) {
  const tenant = opts?.tenant === null ? null : (opts?.tenant ?? createMockTenant())
  const app = createTestApp({ tenant })
  const subscriber = createMockSubscriber()
  const buffer = createMockBuffer()
  const connectionManager = createMockConnectionManager()

  app.use(
    createEventRoutes({
      subscriber: subscriber as any,
      buffer: buffer as any,
      connectionManager: connectionManager as any,
    }),
  )

  return { app, subscriber, buffer, connectionManager }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Event Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── GET /v1/events/replay ─────────────────────────────────────────────

  describe('GET /v1/events/replay', () => {
    it('returns empty events array when buffer is empty', async () => {
      const { app } = buildApp()
      const res = await request(app).get('/v1/events/replay')

      expect(res.status).toBe(200)
      expect(res.body.events).toEqual([])
      expect(res.body.count).toBe(0)
      expect(res.body.hasMore).toBe(false)
    })

    it('replays buffered events for the tenant org', async () => {
      const { app, buffer } = buildApp()
      const mockEvents = [
        { id: 'evt-1', event: { type: 'agent:status', data: { state: 'listening' } } },
        { id: 'evt-2', event: { type: 'transcription', data: { text: 'hello' } } },
      ]
      buffer.replay.mockReturnValue(mockEvents)

      const res = await request(app).get('/v1/events/replay')

      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(2)
      expect(res.body.count).toBe(2)
      expect(buffer.replay).toHaveBeenCalledWith('org-test-123', expect.objectContaining({
        limit: 100,
      }))
    })

    it('passes session filter to buffer.replay', async () => {
      const { app, buffer } = buildApp()
      buffer.replay.mockReturnValue([])

      await request(app).get('/v1/events/replay?session=sess-abc')

      expect(buffer.replay).toHaveBeenCalledWith('org-test-123', expect.objectContaining({
        sessionId: 'sess-abc',
      }))
    })

    it('passes sinceEventId to buffer.replay', async () => {
      const { app, buffer } = buildApp()
      buffer.replay.mockReturnValue([])

      await request(app).get('/v1/events/replay?since=evt-50')

      expect(buffer.replay).toHaveBeenCalledWith('org-test-123', expect.objectContaining({
        sinceEventId: 'evt-50',
      }))
    })

    it('caps the limit to 500', async () => {
      const { app, buffer } = buildApp()
      buffer.replay.mockReturnValue([])

      await request(app).get('/v1/events/replay?limit=9999')

      expect(buffer.replay).toHaveBeenCalledWith('org-test-123', expect.objectContaining({
        limit: 500,
      }))
    })

    it('sets hasMore=true when events.length equals limit', async () => {
      const { app, buffer } = buildApp()
      // Simulate 5 events when limit=5
      const events = Array.from({ length: 5 }, (_, i) => ({
        id: `evt-${i}`,
        event: { type: 'test', data: {} },
      }))
      buffer.replay.mockReturnValue(events)

      const res = await request(app).get('/v1/events/replay?limit=5')

      expect(res.status).toBe(200)
      expect(res.body.hasMore).toBe(true)
    })

    it('returns 401 without tenant context', async () => {
      const { app } = buildApp({ tenant: null })
      const res = await request(app).get('/v1/events/replay')

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('Tenant context required')
    })
  })

  // ── GET /v1/events/stream — SSE endpoint ──────────────────────────────

  describe('GET /v1/events/stream', () => {
    it('returns 401 without tenant context', async () => {
      const { app } = buildApp({ tenant: null })
      const res = await request(app).get('/v1/events/stream')

      expect(res.status).toBe(401)
    })

    it('returns 429 when connection manager rejects the SSE connection', async () => {
      const { app, connectionManager } = buildApp()
      connectionManager.addSSE.mockReturnValue(false)

      const res = await request(app).get('/v1/events/stream')

      expect(res.status).toBe(429)
      expect(res.body.error).toBe('Too many SSE connections')
    })

    it('registers SSE connection with connection manager', async () => {
      const { app, connectionManager, subscriber } = buildApp()

      // Make addSSE write SSE headers to start the response, simulating real behavior
      connectionManager.addSSE.mockImplementation((_connId: string, _orgId: string, res: any) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })
        res.write(':ok\n\n')
        return true
      })
      subscriber.subscribe.mockResolvedValue({ unsubscribe: vi.fn() })

      const http = await import('http')
      const server = app.listen(0)
      const port = (server.address() as any).port

      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/v1/events/stream`, (res) => {
          // Response started, meaning SSE connection was accepted
          res.on('data', () => {
            // got some data, check assertions
          })

          // Give subscribe a tick to complete
          setTimeout(() => {
            try {
              expect(connectionManager.addSSE).toHaveBeenCalledWith(
                expect.stringContaining('sse_'),
                'org-test-123',
                expect.any(Object),
              )
              expect(subscriber.subscribe).toHaveBeenCalled()
              resolve()
            } catch (e) {
              reject(e)
            } finally {
              req.destroy()
              server.close()
            }
          }, 100)
        })
        req.on('error', () => {
          // Expected when we destroy
        })
      })
    })

    it('replays missed events when Last-Event-ID header is provided', async () => {
      const { app, connectionManager, buffer, subscriber } = buildApp()

      connectionManager.addSSE.mockImplementation((_connId: string, _orgId: string, res: any) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })
        res.write(':ok\n\n')
        return true
      })
      subscriber.subscribe.mockResolvedValue({ unsubscribe: vi.fn() })

      const missedEvents = [
        { id: 'evt-5', event: { type: 'status', data: { state: 'speaking' } } },
      ]
      buffer.replay.mockReturnValue(missedEvents)

      const http = await import('http')
      const server = app.listen(0)
      const port = (server.address() as any).port

      await new Promise<void>((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${port}/v1/events/stream`,
          { headers: { 'last-event-id': 'evt-4' } },
          () => {
            setTimeout(() => {
              try {
                expect(buffer.replay).toHaveBeenCalledWith('org-test-123', expect.objectContaining({
                  sinceEventId: 'evt-4',
                  limit: 100,
                }))
                expect(connectionManager.sendEvent).toHaveBeenCalledWith(
                  expect.stringContaining('sse_'),
                  'status',
                  JSON.stringify({ state: 'speaking' }),
                  'evt-5',
                )
                resolve()
              } catch (e) {
                reject(e)
              } finally {
                req.destroy()
                server.close()
              }
            }, 100)
          },
        )
        req.on('error', () => {
          // Expected when we destroy
        })
      })
    })
  })
})


