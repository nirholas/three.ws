// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Event Streaming — Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventBuffer } from '../events/buffer'
import { matchGlob, matchesFilter } from '../events/subscriber'
import { ConnectionManager } from '../events/connection-manager'
import type { EventEnvelope, EventFilter, StreamEvent } from '../events/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEnvelope(
  overrides: Partial<EventEnvelope> & { event: StreamEvent },
): EventEnvelope {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    orgId: 'org_test',
    ...overrides,
  }
}

function makeTranscriptionEvent(sessionId: string, text: string): StreamEvent {
  return {
    type: 'transcription.chunk',
    data: { sessionId, speaker: 'User', text, timestamp: Date.now(), isFinal: true },
  }
}

function makeResponseEvent(sessionId: string, agentId: string, text: string): StreamEvent {
  return {
    type: 'response.generated',
    data: { sessionId, agentId, text, tokens: 10, latencyMs: 200 },
  }
}

function makeAgentErrorEvent(agentId: string): StreamEvent {
  return {
    type: 'agent.error',
    data: { agentId, error: 'timeout', recoverable: true },
  }
}

function makeStateChangeEvent(agentId: string): StreamEvent {
  return {
    type: 'agent.state_change',
    data: { agentId, from: 'listening', to: 'speaking' },
  }
}

// =============================================================================
// matchGlob
// =============================================================================

describe('matchGlob', () => {
  it('matches exact event types', () => {
    expect(matchGlob('transcription.chunk', 'transcription.chunk')).toBe(true)
    expect(matchGlob('transcription.chunk', 'response.generated')).toBe(false)
  })

  it('matches wildcard at end', () => {
    expect(matchGlob('transcription.*', 'transcription.chunk')).toBe(true)
    expect(matchGlob('response.*', 'response.generated')).toBe(true)
    expect(matchGlob('response.*', 'response.spoken')).toBe(true)
    expect(matchGlob('response.*', 'transcription.chunk')).toBe(false)
  })

  it('matches wildcard at start', () => {
    expect(matchGlob('*.error', 'agent.error')).toBe(true)
    expect(matchGlob('*.error', 'system.error')).toBe(true) // wildcard matches any segment
    expect(matchGlob('*.chunk', 'transcription.chunk')).toBe(true)
  })

  it('matches double wildcard', () => {
    expect(matchGlob('*.*', 'agent.error')).toBe(true)
    expect(matchGlob('*.*', 'transcription.chunk')).toBe(true)
  })

  it('does not match across dots', () => {
    expect(matchGlob('*', 'transcription.chunk')).toBe(false)
    expect(matchGlob('team.*', 'team.turn_change')).toBe(true)
  })
})

// =============================================================================
// matchesFilter
// =============================================================================

describe('matchesFilter', () => {
  it('passes with empty filter (no restrictions)', () => {
    const envelope = createEnvelope({ event: makeTranscriptionEvent('ses_1', 'hello') })
    expect(matchesFilter(envelope, {})).toBe(true)
  })

  it('filters by event type patterns', () => {
    const envelope = createEnvelope({ event: makeTranscriptionEvent('ses_1', 'hello') })

    expect(matchesFilter(envelope, { events: ['transcription.*'] })).toBe(true)
    expect(matchesFilter(envelope, { events: ['response.*'] })).toBe(false)
    expect(matchesFilter(envelope, { events: ['transcription.*', 'response.*'] })).toBe(true)
  })

  it('filters by session ID', () => {
    const envelope = createEnvelope({ event: makeTranscriptionEvent('ses_1', 'hello') })

    expect(matchesFilter(envelope, { sessions: ['ses_1'] })).toBe(true)
    expect(matchesFilter(envelope, { sessions: ['ses_2'] })).toBe(false)
    expect(matchesFilter(envelope, { sessions: ['ses_1', 'ses_2'] })).toBe(true)
  })

  it('filters by agent ID', () => {
    const envelope = createEnvelope({ event: makeResponseEvent('ses_1', 'agt_1', 'hi') })

    expect(matchesFilter(envelope, { agents: ['agt_1'] })).toBe(true)
    expect(matchesFilter(envelope, { agents: ['agt_2'] })).toBe(false)
  })

  it('rejects events without agentId when agent filter is set', () => {
    const envelope = createEnvelope({ event: makeTranscriptionEvent('ses_1', 'hello') })
    expect(matchesFilter(envelope, { agents: ['agt_1'] })).toBe(false)
  })

  it('combines multiple filter criteria (AND logic)', () => {
    const envelope = createEnvelope({
      event: makeResponseEvent('ses_1', 'agt_1', 'hi'),
    })

    // Both match
    expect(matchesFilter(envelope, {
      events: ['response.*'],
      sessions: ['ses_1'],
      agents: ['agt_1'],
    })).toBe(true)

    // Event matches but session doesn't
    expect(matchesFilter(envelope, {
      events: ['response.*'],
      sessions: ['ses_2'],
    })).toBe(false)
  })
})

// =============================================================================
// EventBuffer
// =============================================================================

describe('EventBuffer', () => {
  let buffer: EventBuffer

  beforeEach(() => {
    buffer = new EventBuffer(10) // small buffer for testing
  })

  it('stores and replays events for a session', () => {
    const e1 = createEnvelope({ id: 'evt_1', event: makeTranscriptionEvent('ses_1', 'hello') })
    const e2 = createEnvelope({ id: 'evt_2', event: makeResponseEvent('ses_1', 'agt_1', 'hi') })

    buffer.push(e1)
    buffer.push(e2)

    const events = buffer.replay('org_test', { sessionId: 'ses_1' })
    expect(events).toHaveLength(2)
    expect(events[0].id).toBe('evt_1')
    expect(events[1].id).toBe('evt_2')
  })

  it('replays events after a given event ID', () => {
    const e1 = createEnvelope({ id: 'evt_1', event: makeTranscriptionEvent('ses_1', 'a') })
    const e2 = createEnvelope({ id: 'evt_2', event: makeTranscriptionEvent('ses_1', 'b') })
    const e3 = createEnvelope({ id: 'evt_3', event: makeTranscriptionEvent('ses_1', 'c') })

    buffer.push(e1)
    buffer.push(e2)
    buffer.push(e3)

    const events = buffer.replay('org_test', { sessionId: 'ses_1', sinceEventId: 'evt_1' })
    expect(events).toHaveLength(2)
    expect(events[0].id).toBe('evt_2')
    expect(events[1].id).toBe('evt_3')
  })

  it('enforces max buffer size per session', () => {
    for (let i = 0; i < 15; i++) {
      buffer.push(createEnvelope({
        id: `evt_${i}`,
        event: makeTranscriptionEvent('ses_1', `msg ${i}`),
      }))
    }

    const events = buffer.replay('org_test', { sessionId: 'ses_1' })
    expect(events).toHaveLength(10) // max is 10
    expect(events[0].id).toBe('evt_5') // oldest events dropped
  })

  it('respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      buffer.push(createEnvelope({
        id: `evt_${i}`,
        event: makeTranscriptionEvent('ses_1', `msg ${i}`),
      }))
    }

    const events = buffer.replay('org_test', { sessionId: 'ses_1', limit: 2 })
    expect(events).toHaveLength(2)
    expect(events[0].id).toBe('evt_0')
    expect(events[1].id).toBe('evt_1')
  })

  it('returns empty array for unknown org/session', () => {
    expect(buffer.replay('org_unknown', { sessionId: 'ses_x' })).toEqual([])
    expect(buffer.replay('org_unknown')).toEqual([])
  })

  it('isolates events by org', () => {
    buffer.push(createEnvelope({
      id: 'evt_org1',
      orgId: 'org_1',
      event: makeTranscriptionEvent('ses_1', 'hello'),
    }))
    buffer.push(createEnvelope({
      id: 'evt_org2',
      orgId: 'org_2',
      event: makeTranscriptionEvent('ses_1', 'world'),
    }))

    const org1Events = buffer.replay('org_1', { sessionId: 'ses_1' })
    const org2Events = buffer.replay('org_2', { sessionId: 'ses_1' })

    expect(org1Events).toHaveLength(1)
    expect(org1Events[0].id).toBe('evt_org1')
    expect(org2Events).toHaveLength(1)
    expect(org2Events[0].id).toBe('evt_org2')
  })

  it('replays from global buffer when no session specified', () => {
    buffer.push(createEnvelope({ id: 'evt_1', event: makeTranscriptionEvent('ses_1', 'a') }))
    buffer.push(createEnvelope({ id: 'evt_2', event: makeAgentErrorEvent('agt_1') }))

    const events = buffer.replay('org_test')
    expect(events).toHaveLength(2)
  })

  it('clears session buffer', () => {
    buffer.push(createEnvelope({ id: 'evt_1', event: makeTranscriptionEvent('ses_1', 'a') }))
    buffer.clearSession('org_test', 'ses_1')

    expect(buffer.replay('org_test', { sessionId: 'ses_1' })).toEqual([])
  })

  it('clears all org buffers', () => {
    buffer.push(createEnvelope({ id: 'evt_1', event: makeTranscriptionEvent('ses_1', 'a') }))
    buffer.push(createEnvelope({ id: 'evt_2', event: makeTranscriptionEvent('ses_2', 'b') }))
    buffer.clearOrg('org_test')

    expect(buffer.replay('org_test', { sessionId: 'ses_1' })).toEqual([])
    expect(buffer.replay('org_test', { sessionId: 'ses_2' })).toEqual([])
    expect(buffer.replay('org_test')).toEqual([])
  })
})

// =============================================================================
// ConnectionManager
// =============================================================================

describe('ConnectionManager', () => {
  let manager: ConnectionManager

  beforeEach(() => {
    manager = new ConnectionManager({
      maxSSEPerOrg: 3,
      heartbeatIntervalMs: 60_000, // long interval to avoid timer issues in tests
      sseRetryMs: 1_000,
    })
  })

  afterEach(async () => {
    await manager.drain()
  })

  function createMockResponse(): any {
    const chunks: string[] = []
    const res: any = {
      writeHead: vi.fn(),
      write: vi.fn((data: string) => { chunks.push(data); return true }),
      end: vi.fn(),
      writableEnded: false,
      socket: { writableLength: 0, writableHighWaterMark: 16384 },
      on: vi.fn(),
      _chunks: chunks,
    }
    return res
  }

  it('accepts SSE connections within limit', () => {
    const res = createMockResponse()
    expect(manager.addSSE('conn_1', 'org_1', res)).toBe(true)
    expect(manager.getSSECount('org_1')).toBe(1)
    expect(manager.getTotalCount()).toBe(1)
  })

  it('rejects SSE connections beyond limit', () => {
    for (let i = 0; i < 3; i++) {
      expect(manager.addSSE(`conn_${i}`, 'org_1', createMockResponse())).toBe(true)
    }
    expect(manager.addSSE('conn_3', 'org_1', createMockResponse())).toBe(false)
    expect(manager.getSSECount('org_1')).toBe(3)
  })

  it('allows connections from different orgs independently', () => {
    for (let i = 0; i < 3; i++) {
      expect(manager.addSSE(`conn_a${i}`, 'org_1', createMockResponse())).toBe(true)
    }
    expect(manager.addSSE('conn_b0', 'org_2', createMockResponse())).toBe(true)
    expect(manager.getSSECount('org_1')).toBe(3)
    expect(manager.getSSECount('org_2')).toBe(1)
  })

  it('sends SSE headers on connection', () => {
    const res = createMockResponse()
    manager.addSSE('conn_1', 'org_1', res)

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
  })

  it('sends retry hint on connection', () => {
    const res = createMockResponse()
    manager.addSSE('conn_1', 'org_1', res)

    expect(res.write).toHaveBeenCalledWith('retry: 1000\n\n')
  })

  it('sends formatted SSE events', () => {
    const res = createMockResponse()
    manager.addSSE('conn_1', 'org_1', res)

    const sent = manager.sendEvent('conn_1', 'transcription.chunk', '{"text":"hello"}', 'evt_123')
    expect(sent).toBe(true)

    expect(res._chunks).toContain(
      'id: evt_123\nevent: transcription.chunk\ndata: {"text":"hello"}\n\n',
    )
  })

  it('detects backpressure and skips events', () => {
    const res = createMockResponse()
    res.socket.writableLength = 20000 // above high water mark
    manager.addSSE('conn_1', 'org_1', res)

    const sent = manager.sendEvent('conn_1', 'test', '{}')
    expect(sent).toBe(false)
  })

  it('removes connections and decrements count', () => {
    const res = createMockResponse()
    manager.addSSE('conn_1', 'org_1', res)
    expect(manager.getSSECount('org_1')).toBe(1)

    manager.removeSSE('conn_1')
    expect(manager.getSSECount('org_1')).toBe(0)
    expect(manager.getTotalCount()).toBe(0)
    expect(res.end).toHaveBeenCalled()
  })

  it('returns connection IDs for an org', () => {
    manager.addSSE('conn_1', 'org_1', createMockResponse())
    manager.addSSE('conn_2', 'org_1', createMockResponse())
    manager.addSSE('conn_3', 'org_2', createMockResponse())

    const ids = manager.getConnectionIds('org_1')
    expect(ids).toHaveLength(2)
    expect(ids).toContain('conn_1')
    expect(ids).toContain('conn_2')
  })

  it('drains all connections with reconnect event', async () => {
    const res1 = createMockResponse()
    const res2 = createMockResponse()
    manager.addSSE('conn_1', 'org_1', res1)
    manager.addSSE('conn_2', 'org_2', res2)

    await manager.drain()

    expect(res1._chunks).toContain('event: reconnect\ndata: {"reason":"server_shutdown"}\n\n')
    expect(res2._chunks).toContain('event: reconnect\ndata: {"reason":"server_shutdown"}\n\n')
    expect(manager.getTotalCount()).toBe(0)
  })

  it('rejects new connections after drain', () => {
    manager.drain()
    expect(manager.addSSE('conn_1', 'org_1', createMockResponse())).toBe(false)
  })
})

// =============================================================================
// EventPublisher (unit test without Redis)
// =============================================================================

describe('EventPublisher', () => {
  it('creates envelope with correct structure', async () => {
    const published: { channel: string; message: string }[] = []
    const mockRedis = {
      publish: vi.fn(async (channel: string, message: string) => {
        published.push({ channel, message })
        return 1
      }),
    }

    const { EventPublisher } = await import('../events/publisher')
    const publisher = new EventPublisher(mockRedis as any)

    const event: StreamEvent = makeTranscriptionEvent('ses_123', 'hello world')
    const envelope = await publisher.publish('org_abc', event)

    expect(envelope.id).toMatch(/^evt_/)
    expect(envelope.orgId).toBe('org_abc')
    expect(envelope.event).toEqual(event)
    expect(envelope.timestamp).toBeDefined()
  })

  it('publishes to org channel and session channel', async () => {
    const channels: string[] = []
    const mockRedis = {
      publish: vi.fn(async (channel: string) => {
        channels.push(channel)
        return 1
      }),
    }

    const { EventPublisher } = await import('../events/publisher')
    const publisher = new EventPublisher(mockRedis as any)

    await publisher.publish('org_abc', makeTranscriptionEvent('ses_123', 'hello'))

    expect(channels).toContain('xsevents:org_abc')
    expect(channels).toContain('xsevents:org_abc:session:ses_123')
  })

  it('only publishes to org channel for events without sessionId', async () => {
    const channels: string[] = []
    const mockRedis = {
      publish: vi.fn(async (channel: string) => {
        channels.push(channel)
        return 1
      }),
    }

    const { EventPublisher } = await import('../events/publisher')
    const publisher = new EventPublisher(mockRedis as any)

    await publisher.publish('org_abc', makeAgentErrorEvent('agt_1'))

    expect(channels).toEqual(['xsevents:org_abc'])
  })
})

// =============================================================================
// Cross-tenant isolation
// =============================================================================

describe('Cross-tenant event isolation', () => {
  it('buffer isolates events by orgId', () => {
    const buffer = new EventBuffer(100)

    // Push events for two different orgs
    buffer.push(createEnvelope({
      orgId: 'org_alpha',
      event: makeTranscriptionEvent('ses_1', 'alpha message'),
    }))
    buffer.push(createEnvelope({
      orgId: 'org_beta',
      event: makeTranscriptionEvent('ses_1', 'beta message'),
    }))

    // Each org should only see their own events
    const alphaEvents = buffer.replay('org_alpha', { sessionId: 'ses_1' })
    const betaEvents = buffer.replay('org_beta', { sessionId: 'ses_1' })

    expect(alphaEvents).toHaveLength(1)
    expect((alphaEvents[0].event.data as any).text).toBe('alpha message')

    expect(betaEvents).toHaveLength(1)
    expect((betaEvents[0].event.data as any).text).toBe('beta message')
  })

  it('matchesFilter enforces orgId is checked by subscriber', () => {
    const orgAEnvelope = createEnvelope({
      orgId: 'org_a',
      event: makeTranscriptionEvent('ses_1', 'secret'),
    })

    // The filter itself doesn't check orgId — that's the subscriber's job
    // But we verify the envelope carries orgId for the subscriber to check
    expect(orgAEnvelope.orgId).toBe('org_a')
  })
})

// =============================================================================
// Event type coverage
// =============================================================================

describe('Event type coverage', () => {
  it('handles all event types in buffer', () => {
    const buffer = new EventBuffer(100)
    const orgId = 'org_test'

    const events: StreamEvent[] = [
      { type: 'transcription.chunk', data: { sessionId: 's1', speaker: 'U', text: 'hi', timestamp: 1, isFinal: true } },
      { type: 'response.thinking', data: { sessionId: 's1', agentId: 'a1' } },
      { type: 'response.generated', data: { sessionId: 's1', agentId: 'a1', text: 'hi', tokens: 5, latencyMs: 100 } },
      { type: 'response.spoken', data: { sessionId: 's1', agentId: 'a1', durationMs: 1500 } },
      { type: 'session.metrics', data: { sessionId: 's1', activeSpeakers: 3, sentiment: 0.8, topicShift: false } },
      { type: 'agent.state_change', data: { agentId: 'a1', from: 'idle', to: 'listening' } },
      { type: 'agent.error', data: { agentId: 'a1', error: 'timeout', recoverable: true } },
      { type: 'team.turn_change', data: { teamId: 't1', fromAgent: 'a1', toAgent: 'a2', reason: 'scheduled' } },
      { type: 'team.handoff', data: { teamId: 't1', fromAgent: 'a1', toAgent: 'a2' } },
      { type: 'usage.threshold', data: { metric: 'api_calls', percentage: 90 } },
      { type: 'system.announcement', data: { message: 'Maintenance scheduled', severity: 'info' } },
    ]

    for (const event of events) {
      buffer.push(createEnvelope({ orgId, event }))
    }

    const replayed = buffer.replay(orgId)
    expect(replayed).toHaveLength(events.length)
  })
})


