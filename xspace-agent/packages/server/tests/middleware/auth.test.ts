// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§77]

// =============================================================================
// Tests for auth middleware — API key authentication (Express + Socket.IO)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAuthMiddleware, socketAuthMiddleware } from '../../src/middleware/auth'
import type { Request, Response, NextFunction } from 'express'
import type { Socket } from 'socket.io'

// ---------------------------------------------------------------------------
// Helpers — mock Express req/res/next
// ---------------------------------------------------------------------------

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/api/test',
    headers: {},
    query: {},
    ...overrides,
  } as unknown as Request
}

function mockRes(): Response & { _status: number; _json: unknown } {
  const res: any = {
    _status: 0,
    _json: null,
    status(code: number) {
      res._status = code
      return res
    },
    json(body: unknown) {
      res._json = body
      return res
    },
  }
  return res
}

function mockNext(): NextFunction & { called: boolean } {
  const fn: any = vi.fn()
  Object.defineProperty(fn, 'called', {
    get: () => fn.mock.calls.length > 0,
  })
  return fn
}

// ---------------------------------------------------------------------------
// Helpers — mock Socket.IO socket
// ---------------------------------------------------------------------------

function mockSocket(
  auth: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Socket {
  return {
    handshake: {
      auth,
      headers,
    },
  } as unknown as Socket
}

// =============================================================================
// createAuthMiddleware
// =============================================================================

describe('createAuthMiddleware', () => {
  const API_KEY = 'test-secret-key-1234'
  let middleware: ReturnType<typeof createAuthMiddleware>

  beforeEach(() => {
    middleware = createAuthMiddleware(API_KEY)
  })

  // ── Health check bypass ─────────────────────────────────

  it('skips auth for /health endpoint', () => {
    const req = mockReq({ path: '/health' })
    const res = mockRes()
    const next = mockNext()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res._status).toBe(0) // no status set
  })

  // ── X-API-Key header ────────────────────────────────────

  it('authenticates via X-API-Key header', () => {
    const req = mockReq({
      headers: { 'x-api-key': API_KEY } as any,
    })
    const res = mockRes()
    const next = mockNext()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res._status).toBe(0)
  })

  it('rejects invalid X-API-Key header', () => {
    const req = mockReq({
      headers: { 'x-api-key': 'wrong-key' } as any,
    })
    const res = mockRes()
    const next = mockNext()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(401)
    expect(res._json).toEqual({
      error: 'Unauthorized',
      hint: 'Provide API key via X-API-Key header',
    })
  })

  // ── Authorization: Bearer header ────────────────────────

  it('authenticates via Authorization: Bearer header', () => {
    const req = mockReq({
      headers: { authorization: `Bearer ${API_KEY}` } as any,
    })
    const res = mockRes()
    const next = mockNext()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('rejects invalid Bearer token', () => {
    const req = mockReq({
      headers: { authorization: 'Bearer wrong-token' } as any,
    })
    const res = mockRes()
    const next = mockNext()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(401)
  })

  // ── Query parameter ─────────────────────────────────────

  it('authenticates via ?apiKey query parameter', () => {
    const req = mockReq({
      query: { apiKey: API_KEY },
    })
    const res = mockRes()
    const next = mockNext()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('rejects invalid query parameter key', () => {
    const req = mockReq({
      query: { apiKey: 'wrong-key' },
    })
    const res = mockRes()
    const next = mockNext()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(401)
  })

  // ── Missing key ─────────────────────────────────────────

  it('returns 401 when no key is provided', () => {
    const req = mockReq()
    const res = mockRes()
    const next = mockNext()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(401)
    expect(res._json).toMatchObject({ error: 'Unauthorized' })
  })

  // ── Priority: X-API-Key header takes precedence ─────────

  it('uses X-API-Key over Authorization and query', () => {
    const req = mockReq({
      headers: {
        'x-api-key': API_KEY,
        authorization: 'Bearer wrong-token',
      } as any,
      query: { apiKey: 'also-wrong' },
    })
    const res = mockRes()
    const next = mockNext()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  // ── Edge cases ──────────────────────────────────────────

  it('rejects empty string key', () => {
    const req = mockReq({
      headers: { 'x-api-key': '' } as any,
    })
    const res = mockRes()
    const next = mockNext()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(401)
  })

  it('handles keys of different lengths safely (timing-safe)', () => {
    const req = mockReq({
      headers: { 'x-api-key': 'short' } as any,
    })
    const res = mockRes()
    const next = mockNext()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(401)
  })
})

// =============================================================================
// socketAuthMiddleware
// =============================================================================

describe('socketAuthMiddleware', () => {
  const API_KEY = 'socket-secret-key-5678'
  let middleware: ReturnType<typeof socketAuthMiddleware>

  beforeEach(() => {
    middleware = socketAuthMiddleware(API_KEY)
  })

  it('authenticates via handshake.auth.apiKey', () => {
    const socket = mockSocket({ apiKey: API_KEY })
    const next = vi.fn()

    middleware(socket, next)

    expect(next).toHaveBeenCalledWith() // no error
  })

  it('authenticates via x-api-key header', () => {
    const socket = mockSocket({}, { 'x-api-key': API_KEY })
    const next = vi.fn()

    middleware(socket, next)

    expect(next).toHaveBeenCalledWith()
  })

  it('rejects invalid apiKey in auth', () => {
    const socket = mockSocket({ apiKey: 'wrong' })
    const next = vi.fn()

    middleware(socket, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
    expect((next.mock.calls[0][0] as Error).message).toBe('unauthorized')
  })

  it('rejects when no key is provided', () => {
    const socket = mockSocket()
    const next = vi.fn()

    middleware(socket, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
    expect((next.mock.calls[0][0] as Error).message).toBe('unauthorized')
  })

  it('prefers handshake.auth.apiKey over header', () => {
    const socket = mockSocket({ apiKey: API_KEY }, { 'x-api-key': 'wrong' })
    const next = vi.fn()

    middleware(socket, next)

    expect(next).toHaveBeenCalledWith() // auth.apiKey wins
  })

  it('falls back to header when auth.apiKey is missing', () => {
    const socket = mockSocket({}, { 'x-api-key': API_KEY })
    const next = vi.fn()

    middleware(socket, next)

    expect(next).toHaveBeenCalledWith()
  })

  it('rejects invalid header key', () => {
    const socket = mockSocket({}, { 'x-api-key': 'bad-key' })
    const next = vi.fn()

    middleware(socket, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
  })
})


