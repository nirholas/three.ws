// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// =============================================================================
// Tests for validation middleware — Zod schema validation + Socket.IO events
// =============================================================================

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  validate,
  SpaceUrlSchema,
  SocketEventSchemas,
  validateSocketEvent,
} from '../../src/middleware/validation'
import type { Request, Response, NextFunction } from 'express'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockReq(overrides: Partial<Record<string, unknown>> = {}): Request {
  return {
    body: {},
    query: {},
    params: {},
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

// =============================================================================
// validate middleware
// =============================================================================

describe('validate', () => {
  const testSchema = z.object({
    name: z.string().min(1),
    count: z.number().int().positive(),
  })

  it('validates req.body by default and sets req.validated', () => {
    const middleware = validate(testSchema)
    const req = mockReq({ body: { name: 'test', count: 5 } })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect((req as any).validated).toEqual({ name: 'test', count: 5 })
  })

  it('returns 400 when body validation fails', () => {
    const middleware = validate(testSchema)
    const req = mockReq({ body: { name: '', count: -1 } })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(400)
    expect(res._json).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
      },
    })
    expect((res._json as any).error.details).toBeInstanceOf(Array)
    expect((res._json as any).error.details.length).toBeGreaterThan(0)
  })

  it('validates req.query when source is "query"', () => {
    const querySchema = z.object({
      page: z.string().regex(/^\d+$/),
    })
    const middleware = validate(querySchema, 'query')
    const req = mockReq({ query: { page: '5' } })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect((req as any).validated).toEqual({ page: '5' })
  })

  it('validates req.params when source is "params"', () => {
    const paramsSchema = z.object({
      id: z.string().uuid(),
    })
    const middleware = validate(paramsSchema, 'params')
    const req = mockReq({ params: { id: '550e8400-e29b-41d4-a716-446655440000' } })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('includes hint about source in validation error', () => {
    const middleware = validate(testSchema, 'query')
    const req = mockReq({ query: { bad: 'data' } })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(res._status).toBe(400)
    expect((res._json as any).error.hint).toContain('query')
  })

  it('includes requestId in error response when available', () => {
    const middleware = validate(testSchema)
    const req = mockReq({ body: { invalid: true }, id: 'req-abc' })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect((res._json as any).error.requestId).toBe('req-abc')
  })

  it('maps field paths correctly in validation details', () => {
    const nestedSchema = z.object({
      user: z.object({
        email: z.string().email(),
      }),
    })
    const middleware = validate(nestedSchema)
    const req = mockReq({ body: { user: { email: 'not-an-email' } } })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(res._status).toBe(400)
    const details = (res._json as any).error.details
    expect(details[0].field).toBe('user.email')
  })

  it('applies Zod transforms and defaults', () => {
    const transformSchema = z.object({
      name: z.string().transform((s) => s.toUpperCase()),
      active: z.boolean().default(true),
    })
    const middleware = validate(transformSchema)
    const req = mockReq({ body: { name: 'hello' } })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect((req as any).validated).toEqual({ name: 'HELLO', active: true })
  })
})

// =============================================================================
// SpaceUrlSchema
// =============================================================================

describe('SpaceUrlSchema', () => {
  it('accepts valid x.com Space URL', () => {
    const result = SpaceUrlSchema.safeParse('https://x.com/i/spaces/1eaJbrPWAAAJx')
    expect(result.success).toBe(true)
  })

  it('accepts valid twitter.com Space URL', () => {
    const result = SpaceUrlSchema.safeParse('https://twitter.com/i/spaces/1eaJbrPWAAAJx')
    expect(result.success).toBe(true)
  })

  it('rejects non-URL strings', () => {
    const result = SpaceUrlSchema.safeParse('not-a-url')
    expect(result.success).toBe(false)
  })

  it('rejects URLs from other domains', () => {
    const result = SpaceUrlSchema.safeParse('https://example.com/i/spaces/abc123')
    expect(result.success).toBe(false)
  })

  it('rejects x.com URLs without /i/spaces/ path', () => {
    const result = SpaceUrlSchema.safeParse('https://x.com/home')
    expect(result.success).toBe(false)
  })

  it('rejects x.com URLs with /i/spaces/ but no ID', () => {
    const result = SpaceUrlSchema.safeParse('https://x.com/i/spaces/')
    expect(result.success).toBe(false)
  })

  it('accepts Space URL with query parameters', () => {
    const result = SpaceUrlSchema.safeParse('https://x.com/i/spaces/1eaJbrPWAAAJx?ref=home')
    expect(result.success).toBe(true)
  })

  it('rejects empty string', () => {
    const result = SpaceUrlSchema.safeParse('')
    expect(result.success).toBe(false)
  })
})

// =============================================================================
// SocketEventSchemas
// =============================================================================

describe('SocketEventSchemas', () => {
  it('defines schema for xspace:start', () => {
    expect(SocketEventSchemas['xspace:start']).toBeDefined()
  })

  it('defines schema for xspace:join', () => {
    expect(SocketEventSchemas['xspace:join']).toBeDefined()
  })

  it('defines schema for xspace:2fa', () => {
    expect(SocketEventSchemas['xspace:2fa']).toBeDefined()
  })

  it('defines schema for admin:override-selector', () => {
    expect(SocketEventSchemas['admin:override-selector']).toBeDefined()
  })

  it('defines schema for orchestrator:force-speak', () => {
    expect(SocketEventSchemas['orchestrator:force-speak']).toBeDefined()
  })
})

// =============================================================================
// validateSocketEvent
// =============================================================================

describe('validateSocketEvent', () => {
  // ── xspace:start ────────────────────────────────────────

  it('validates valid xspace:start event', () => {
    const result = validateSocketEvent('xspace:start', {
      spaceUrl: 'https://x.com/i/spaces/1eaJbrPWAAAJx',
    })

    expect(result.valid).toBe(true)
    expect(result.data).toMatchObject({
      spaceUrl: 'https://x.com/i/spaces/1eaJbrPWAAAJx',
    })
  })

  it('rejects xspace:start with invalid URL', () => {
    const result = validateSocketEvent('xspace:start', {
      spaceUrl: 'not-a-url',
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects xspace:start with missing spaceUrl', () => {
    const result = validateSocketEvent('xspace:start', {})

    expect(result.valid).toBe(false)
  })

  // ── xspace:2fa ──────────────────────────────────────────

  it('validates valid 2FA code (6 digits)', () => {
    const result = validateSocketEvent('xspace:2fa', { code: '123456' })
    expect(result.valid).toBe(true)
  })

  it('validates valid 2FA code (8 digits)', () => {
    const result = validateSocketEvent('xspace:2fa', { code: '12345678' })
    expect(result.valid).toBe(true)
  })

  it('rejects 2FA code with non-digit characters', () => {
    const result = validateSocketEvent('xspace:2fa', { code: 'abcdef' })
    expect(result.valid).toBe(false)
  })

  it('rejects 2FA code that is too short', () => {
    const result = validateSocketEvent('xspace:2fa', { code: '12345' })
    expect(result.valid).toBe(false)
  })

  // ── admin:override-selector ─────────────────────────────

  it('validates valid selector override', () => {
    const result = validateSocketEvent('admin:override-selector', {
      name: 'joinButton',
      selector: 'button[data-testid="join"]',
    })

    expect(result.valid).toBe(true)
  })

  it('rejects selector override with empty name', () => {
    const result = validateSocketEvent('admin:override-selector', {
      name: '',
      selector: 'button',
    })

    expect(result.valid).toBe(false)
  })

  it('rejects selector override with empty selector', () => {
    const result = validateSocketEvent('admin:override-selector', {
      name: 'test',
      selector: '',
    })

    expect(result.valid).toBe(false)
  })

  // ── orchestrator:force-speak ────────────────────────────

  it('validates valid force-speak event', () => {
    const result = validateSocketEvent('orchestrator:force-speak', {
      botId: 'agent-1',
    })

    expect(result.valid).toBe(true)
  })

  it('rejects force-speak with empty botId', () => {
    const result = validateSocketEvent('orchestrator:force-speak', {
      botId: '',
    })

    expect(result.valid).toBe(false)
  })

  // ── Unknown events ──────────────────────────────────────

  it('passes through unknown events without validation', () => {
    const result = validateSocketEvent('custom:unknown-event', {
      anything: 'goes',
    })

    expect(result.valid).toBe(true)
    expect(result.data).toEqual({ anything: 'goes' })
  })

  it('passes through events with no registered schema', () => {
    const result = validateSocketEvent('nonexistent', null)

    expect(result.valid).toBe(true)
    expect(result.data).toBeNull()
  })
})


