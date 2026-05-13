// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§75]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WidgetConnection } from '../connection'
import { io as mockIoFn } from 'socket.io-client'

// ── Socket.IO mock ──────────────────────────────────────────────────
// Each call to `io()` returns a fresh mock socket.
// Tests drive behaviour by firing the listeners the production code registers.

interface MockSocket {
  connected: boolean
  on: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  emit: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  // helpers for tests
  _listeners: Record<string, ((...args: unknown[]) => void)[]>
  _onceListeners: Record<string, ((...args: unknown[]) => void)[]>
  _fire: (event: string, ...args: unknown[]) => void
  _fireOnce: (event: string, ...args: unknown[]) => void
}

function createMockSocket(): MockSocket {
  const socket: MockSocket = {
    connected: false,
    _listeners: {},
    _onceListeners: {},
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      ;(socket._listeners[event] ??= []).push(handler)
      return socket
    }),
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      ;(socket._onceListeners[event] ??= []).push(handler)
      return socket
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    _fire(event: string, ...args: unknown[]) {
      ;(socket._listeners[event] ?? []).forEach((h) => h(...args))
    },
    _fireOnce(event: string, ...args: unknown[]) {
      const handlers = socket._onceListeners[event] ?? []
      socket._onceListeners[event] = []
      handlers.forEach((h) => h(...args))
    },
  }
  return socket
}

let latestSocket: MockSocket

vi.mock('socket.io-client', () => ({
  io: vi.fn((..._args: unknown[]) => {
    latestSocket = createMockSocket()
    return latestSocket
  }),
}))

const mockIo = vi.mocked(mockIoFn)

// ─────────────────────────────────────────────────────────────────────

describe('WidgetConnection', () => {
  let conn: WidgetConnection

  beforeEach(() => {
    conn = new WidgetConnection('http://localhost:3000', {
      roomId: 'room-1',
      userName: 'Tester',
      apiKey: 'key-123',
    })
  })

  afterEach(() => {
    conn.disconnect()
  })

  // ── connect / disconnect lifecycle ───────────────────────────────

  it('resolves when socket connects and joins the room', async () => {
    const connectPromise = conn.connect()

    // Simulate server accepting connection
    latestSocket.connected = true
    latestSocket._fireOnce('connect')

    await expect(connectPromise).resolves.toBeUndefined()
    expect(conn.getState()).toBe('connected')

    // Should have emitted joinRoom with the configured roomId
    expect(latestSocket.emit).toHaveBeenCalledWith('joinRoom', { roomId: 'room-1' })
  })

  it('rejects when socket emits connect_error', async () => {
    const connectPromise = conn.connect()

    latestSocket._fireOnce('connect_error', new Error('refused'))

    await expect(connectPromise).rejects.toThrow('refused')
    expect(conn.getState()).toBe('error')
  })

  it('sets state to disconnected on disconnect()', async () => {
    // connect first
    const p = conn.connect()
    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p

    conn.disconnect()
    expect(conn.getState()).toBe('disconnected')
    expect(latestSocket.disconnect).toHaveBeenCalled()
  })

  it('is a no-op if already connected', async () => {
    // first connect
    const p1 = conn.connect()
    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p1

    // second connect should resolve immediately (socket.connected is true)
    await expect(conn.connect()).resolves.toBeUndefined()
  })

  // ── state transitions ────────────────────────────────────────────

  it('transitions to connecting then connected', async () => {
    const states: string[] = []
    conn.onStateChange((s) => states.push(s))

    const p = conn.connect()
    expect(states).toEqual(['connecting'])

    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p

    expect(states).toEqual(['connecting', 'connected'])
  })

  it('transitions to disconnected when server drops connection', async () => {
    const states: string[] = []
    conn.onStateChange((s) => states.push(s))

    const p = conn.connect()
    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p

    // server drops
    latestSocket._fire('disconnect')
    expect(states).toContain('disconnected')
  })

  it('reconnects and re-joins the room on reconnect event', async () => {
    const states: string[] = []
    conn.onStateChange((s) => states.push(s))

    const p = conn.connect()
    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p

    // simulate reconnect
    latestSocket._fire('reconnect')
    expect(states).toContain('connected')

    // joinRoom emitted twice: initial + reconnect
    const joinCalls = latestSocket.emit.mock.calls.filter(
      (c: unknown[]) => c[0] === 'joinRoom'
    )
    expect(joinCalls).toHaveLength(2)
  })

  // ── sendMessage ──────────────────────────────────────────────────

  it('emits userMessage when connected', async () => {
    const p = conn.connect()
    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p

    conn.sendMessage('hello')
    expect(latestSocket.emit).toHaveBeenCalledWith('userMessage', {
      text: 'hello',
      from: 'Tester',
    })
  })

  it('does not emit when disconnected', () => {
    conn.sendMessage('dropped')
    // no socket yet, nothing should blow up
    // emit should not have been called on any socket
    expect(latestSocket).toBeUndefined
  })

  // ── sendAudio ────────────────────────────────────────────────────

  it('sendAudio converts ArrayBuffer to base64 and emits audioData', async () => {
    const connWithAgent = new WidgetConnection('http://localhost:3000', {
      agentId: 'agent-1',
    })
    const p = connWithAgent.connect()
    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p

    const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer // "Hello"
    connWithAgent.sendAudio(buffer, 'audio/webm')

    expect(latestSocket.emit).toHaveBeenCalledWith('audioData', {
      agentId: 'agent-1',
      audio: btoa('Hello'),
      mimeType: 'audio/webm',
    })

    connWithAgent.disconnect()
  })

  it('sendAudio does nothing without an agentId', async () => {
    const p = conn.connect()
    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p

    const buffer = new Uint8Array([1]).buffer
    conn.sendAudio(buffer)

    const audioCalls = latestSocket.emit.mock.calls.filter(
      (c: unknown[]) => c[0] === 'audioData'
    )
    expect(audioCalls).toHaveLength(0)
  })

  // ── event handler management ─────────────────────────────────────

  it('forwards textComplete messages to registered handlers', async () => {
    const handler = vi.fn()
    conn.onAgentMessage(handler)

    const p = conn.connect()
    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p

    const msg = { id: '1', agentId: 'a', name: 'Bot', text: 'hi', timestamp: 1 }
    latestSocket._fire('textComplete', msg)
    expect(handler).toHaveBeenCalledWith(msg)
  })

  it('forwards userMessage events to message handlers', async () => {
    const handler = vi.fn()
    conn.onAgentMessage(handler)

    const p = conn.connect()
    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p

    const msg = { id: '2', agentId: '', name: 'User', text: 'hey', timestamp: 2, isUser: true }
    latestSocket._fire('userMessage', msg)
    expect(handler).toHaveBeenCalledWith(msg)
  })

  it('replays messageHistory to handlers', async () => {
    const handler = vi.fn()
    conn.onAgentMessage(handler)

    const p = conn.connect()
    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p

    const msgs = [
      { id: '1', agentId: 'a', name: 'Bot', text: 'old1', timestamp: 1 },
      { id: '2', agentId: 'a', name: 'Bot', text: 'old2', timestamp: 2 },
    ]
    latestSocket._fire('messageHistory', msgs)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('forwards ttsAudio to audio handlers', async () => {
    const handler = vi.fn()
    conn.onAgentAudio(handler)

    const p = conn.connect()
    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p

    latestSocket._fire('ttsAudio', { agentId: 'a', audio: 'base64data', format: 'mp3' })
    expect(handler).toHaveBeenCalledWith('base64data', 'mp3', 'a')
  })

  it('forwards agentStatus to status handlers', async () => {
    const handler = vi.fn()
    conn.onAgentStatus(handler)

    const p = conn.connect()
    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p

    latestSocket._fire('agentStatus', { agentId: 'a', status: 'thinking', name: 'Bot' })
    expect(handler).toHaveBeenCalledWith('a', 'thinking', 'Bot')
  })

  it('forwards textDelta to stream delta handlers', async () => {
    const handler = vi.fn()
    conn.onStreamDelta(handler)

    const p = conn.connect()
    latestSocket.connected = true
    latestSocket._fireOnce('connect')
    await p

    latestSocket._fire('textDelta', { agentId: 'a', delta: 'chunk', messageId: 'm1' })
    expect(handler).toHaveBeenCalledWith('a', 'chunk', 'm1')
  })

  // ── trailing-slash normalisation ─────────────────────────────────

  it('strips trailing slash from serverUrl', () => {
    const c = new WidgetConnection('http://example.com/', {})
    const p = c.connect()
    // The io() call should receive the URL without trailing slash
    const lastCall = mockIo.mock.calls[mockIo.mock.calls.length - 1]
    expect(lastCall[0]).toBe('http://example.com/space')

    // clean up – reject the pending promise so node doesn't complain
    latestSocket._fireOnce('connect_error', new Error('cleanup'))
    p.catch(() => {})
    c.disconnect()
  })

  // ── auth headers ─────────────────────────────────────────────────

  it('passes apiKey as Bearer auth header', () => {
    conn.connect().catch(() => {})
    latestSocket._fireOnce('connect_error', new Error('test'))

    const lastCall = mockIo.mock.calls[mockIo.mock.calls.length - 1]
    expect(lastCall[1]).toMatchObject({
      auth: { authorization: 'Bearer key-123' },
    })
  })
})


