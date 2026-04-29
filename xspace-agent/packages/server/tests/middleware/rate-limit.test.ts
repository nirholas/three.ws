// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Tests for rate-limit middleware — in-memory rate limiter + Express middleware
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RateLimiter, rateLimitMiddleware } from '../../src/middleware/rate-limit'
import type { Request, Response, NextFunction } from 'express'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockReq(ip: string = '127.0.0.1'): Request {
  return {
    ip,
  } as unknown as Request
}

function mockRes(): Response & { _status: number; _json: unknown; _headers: Record<string, string> } {
  const res: any = {
    _status: 0,
    _json: null,
    _headers: {},
    status(code: number) {
      res._status = code
      return res
    },
    json(body: unknown) {
      res._json = body
      return res
    },
    set(key: string, value: string) {
      res._headers[key] = value
      return res
    },
  }
  return res
}

// =============================================================================
// RateLimiter class
// =============================================================================

describe('RateLimiter', () => {
  let limiter: RateLimiter

  afterEach(() => {
    limiter?.destroy()
  })

  it('allows requests within the limit', () => {
    limiter = new RateLimiter(5, 60000)

    const r1 = limiter.check('user-1')
    const r2 = limiter.check('user-1')
    const r3 = limiter.check('user-1')

    expect(r1.allowed).toBe(true)
    expect(r2.allowed).toBe(true)
    expect(r3.allowed).toBe(true)
  })

  it('blocks requests exceeding the limit', () => {
    limiter = new RateLimiter(3, 60000)

    limiter.check('user-1') // 1
    limiter.check('user-1') // 2
    limiter.check('user-1') // 3

    const r4 = limiter.check('user-1')
    expect(r4.allowed).toBe(false)
    expect(r4.retryAfterMs).toBeDefined()
    expect(r4.retryAfterMs).toBeGreaterThan(0)
  })

  it('tracks separate keys independently', () => {
    limiter = new RateLimiter(2, 60000)

    limiter.check('user-a') // a:1
    limiter.check('user-a') // a:2

    const ra = limiter.check('user-a')
    expect(ra.allowed).toBe(false) // a is blocked

    const rb = limiter.check('user-b')
    expect(rb.allowed).toBe(true) // b is still open
  })

  it('resets window after expiry', () => {
    vi.useFakeTimers()

    try {
      limiter = new RateLimiter(2, 1000) // 1 second window

      limiter.check('k')
      limiter.check('k')
      expect(limiter.check('k').allowed).toBe(false)

      // Advance past the window
      vi.advanceTimersByTime(1100)

      expect(limiter.check('k').allowed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows exactly maxRequests per window', () => {
    limiter = new RateLimiter(5, 60000)

    for (let i = 0; i < 5; i++) {
      expect(limiter.check('x').allowed).toBe(true)
    }

    expect(limiter.check('x').allowed).toBe(false)
  })

  // ── cleanup ─────────────────────────────────────────────

  it('cleanup removes expired windows', () => {
    vi.useFakeTimers()

    try {
      limiter = new RateLimiter(10, 1000)

      limiter.check('expired-key')
      vi.advanceTimersByTime(2000) // past window

      limiter.cleanup()

      // After cleanup, expired-key should be gone; next check starts fresh
      const result = limiter.check('expired-key')
      expect(result.allowed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cleanup preserves active windows', () => {
    vi.useFakeTimers()

    try {
      limiter = new RateLimiter(3, 60000)

      limiter.check('active-key') // count: 1

      limiter.cleanup() // should not remove active-key

      limiter.check('active-key') // count: 2
      limiter.check('active-key') // count: 3

      expect(limiter.check('active-key').allowed).toBe(false) // count: 3 = max
    } finally {
      vi.useRealTimers()
    }
  })

  // ── destroy ─────────────────────────────────────────────

  it('destroy stops the cleanup interval', () => {
    limiter = new RateLimiter(10, 1000)

    // Should not throw
    limiter.destroy()
    limiter.destroy() // calling twice is safe
  })

  // ── maxRequests = 1 edge case ───────────────────────────

  it('handles maxRequests of 1', () => {
    limiter = new RateLimiter(1, 60000)

    expect(limiter.check('only-one').allowed).toBe(true)
    expect(limiter.check('only-one').allowed).toBe(false)
  })
})

// =============================================================================
// rateLimitMiddleware
// =============================================================================

describe('rateLimitMiddleware', () => {
  let limiter: RateLimiter

  afterEach(() => {
    limiter?.destroy()
  })

  it('calls next() when within rate limit', () => {
    limiter = new RateLimiter(10, 60000)
    const middleware = rateLimitMiddleware(limiter)
    const req = mockReq('10.0.0.1')
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res._status).toBe(0) // not set
  })

  it('returns 429 when rate limit is exceeded', () => {
    limiter = new RateLimiter(1, 60000)
    const middleware = rateLimitMiddleware(limiter)

    // First request: allowed
    const res1 = mockRes()
    middleware(mockReq('10.0.0.1'), res1, vi.fn())

    // Second request: blocked
    const res2 = mockRes()
    const next2 = vi.fn()
    middleware(mockReq('10.0.0.1'), res2, next2)

    expect(next2).not.toHaveBeenCalled()
    expect(res2._status).toBe(429)
    expect(res2._json).toMatchObject({
      error: 'Too many requests',
    })
    expect(res2._json).toHaveProperty('retryAfterMs')
  })

  it('sets Retry-After header on 429', () => {
    limiter = new RateLimiter(1, 60000)
    const middleware = rateLimitMiddleware(limiter)

    middleware(mockReq('1.2.3.4'), mockRes(), vi.fn()) // use up quota

    const res = mockRes()
    middleware(mockReq('1.2.3.4'), res, vi.fn())

    expect(res._headers['Retry-After']).toBeDefined()
    const retryAfter = parseInt(res._headers['Retry-After'], 10)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)
  })

  it('uses req.ip as the rate limit key', () => {
    limiter = new RateLimiter(1, 60000)
    const middleware = rateLimitMiddleware(limiter)

    // IP A: use up limit
    middleware(mockReq('10.0.0.1'), mockRes(), vi.fn())
    const resA = mockRes()
    middleware(mockReq('10.0.0.1'), resA, vi.fn())
    expect(resA._status).toBe(429)

    // IP B: still has quota
    const resB = mockRes()
    const nextB = vi.fn()
    middleware(mockReq('10.0.0.2'), resB, nextB)
    expect(nextB).toHaveBeenCalled()
  })

  it('handles undefined req.ip gracefully', () => {
    limiter = new RateLimiter(10, 60000)
    const middleware = rateLimitMiddleware(limiter)

    const req = { ip: undefined } as unknown as Request
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled() // should use 'unknown' as key
  })
})


