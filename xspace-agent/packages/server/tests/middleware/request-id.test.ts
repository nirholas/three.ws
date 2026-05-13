// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Tests for request-id middleware — UUID generation and X-Request-ID forwarding
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requestIdMiddleware } from '../../src/middleware/request-id'
import type { Request, Response, NextFunction } from 'express'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockReq(headers: Record<string, string> = {}): Request {
  return {
    headers,
    method: 'GET',
    path: '/test',
  } as unknown as Request
}

function mockRes(): Response & { _headers: Record<string, string> } {
  const res: any = {
    _headers: {},
    setHeader(key: string, value: string) {
      res._headers[key] = value
      return res
    },
  }
  return res
}

// =============================================================================
// requestIdMiddleware
// =============================================================================

describe('requestIdMiddleware', () => {
  it('generates a UUID when no X-Request-ID header is present', () => {
    const req = mockReq()
    const res = mockRes()
    const next = vi.fn()

    requestIdMiddleware(req, res, next)

    // UUID v4 pattern
    const id = (req as any).id
    expect(id).toBeDefined()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(next).toHaveBeenCalled()
  })

  it('reuses client-provided X-Request-ID header', () => {
    const clientId = 'client-request-id-abc'
    const req = mockReq({ 'x-request-id': clientId })
    const res = mockRes()
    const next = vi.fn()

    requestIdMiddleware(req, res, next)

    expect((req as any).id).toBe(clientId)
  })

  it('sets X-Request-ID on the response', () => {
    const req = mockReq()
    const res = mockRes()
    const next = vi.fn()

    requestIdMiddleware(req, res, next)

    expect(res._headers['X-Request-ID']).toBeDefined()
    expect(res._headers['X-Request-ID']).toBe((req as any).id)
  })

  it('echoes client-provided ID in response header', () => {
    const clientId = 'my-custom-id-999'
    const req = mockReq({ 'x-request-id': clientId })
    const res = mockRes()
    const next = vi.fn()

    requestIdMiddleware(req, res, next)

    expect(res._headers['X-Request-ID']).toBe(clientId)
  })

  it('attaches a child logger at req.log', () => {
    const req = mockReq()
    const res = mockRes()
    const next = vi.fn()

    requestIdMiddleware(req, res, next)

    const log = (req as any).log
    expect(log).toBeDefined()
    // Pino logger should have standard methods
    expect(typeof log.info).toBe('function')
    expect(typeof log.error).toBe('function')
    expect(typeof log.warn).toBe('function')
  })

  it('calls next() to continue the middleware chain', () => {
    const req = mockReq()
    const res = mockRes()
    const next = vi.fn()

    requestIdMiddleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
  })

  it('generates unique IDs for different requests', () => {
    const req1 = mockReq()
    const req2 = mockReq()
    const res1 = mockRes()
    const res2 = mockRes()
    const next = vi.fn()

    requestIdMiddleware(req1, res1, next)
    requestIdMiddleware(req2, res2, next)

    expect((req1 as any).id).not.toBe((req2 as any).id)
  })
})


