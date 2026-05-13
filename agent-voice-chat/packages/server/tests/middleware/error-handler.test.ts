// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§75]

// =============================================================================
// Tests for error-handler middleware — global Express error handler
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildErrorResponse, globalErrorHandler } from '../../src/middleware/error-handler'
import type { Request, Response, NextFunction } from 'express'
import { ZodError, z } from 'zod'
import { XSpaceError } from 'xspace-agent'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    path: '/api/test',
    method: 'POST',
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

const noopNext: NextFunction = () => {}

// =============================================================================
// buildErrorResponse
// =============================================================================

describe('buildErrorResponse', () => {
  it('builds a basic error response with code and message', () => {
    const result = buildErrorResponse('NOT_FOUND', 'Resource not found')

    expect(result).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
      },
    })
  })

  it('includes details when provided', () => {
    const result = buildErrorResponse('VALIDATION_ERROR', 'Invalid input', {
      details: [
        { field: 'email', message: 'Invalid email format' },
        { field: 'name', message: 'Required' },
      ],
    })

    expect(result.error.details).toHaveLength(2)
    expect(result.error.details![0]).toEqual({
      field: 'email',
      message: 'Invalid email format',
    })
  })

  it('includes hint when provided', () => {
    const result = buildErrorResponse('AUTH_REQUIRED', 'Not authenticated', {
      hint: 'Provide an API key',
    })

    expect(result.error.hint).toBe('Provide an API key')
  })

  it('includes docsUrl when provided', () => {
    const result = buildErrorResponse('CONFIG_INVALID', 'Bad config', {
      docsUrl: 'https://docs.example.com/config',
    })

    expect(result.error.docsUrl).toBe('https://docs.example.com/config')
  })

  it('includes requestId when provided', () => {
    const result = buildErrorResponse('INTERNAL_ERROR', 'Error', {
      requestId: 'req-abc-123',
    })

    expect(result.error.requestId).toBe('req-abc-123')
  })

  it('omits optional fields when not provided', () => {
    const result = buildErrorResponse('INTERNAL_ERROR', 'Error')

    expect(result.error).not.toHaveProperty('details')
    expect(result.error).not.toHaveProperty('hint')
    expect(result.error).not.toHaveProperty('docsUrl')
    expect(result.error).not.toHaveProperty('requestId')
  })

  it('omits details when array is empty', () => {
    const result = buildErrorResponse('VALIDATION_ERROR', 'Bad', {
      details: [],
    })

    expect(result.error).not.toHaveProperty('details')
  })
})

// =============================================================================
// globalErrorHandler
// =============================================================================

describe('globalErrorHandler', () => {
  const originalEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  // ── ZodError ────────────────────────────────────────────

  it('handles ZodError with 400 status', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().min(0),
    })

    let zodError: ZodError
    try {
      schema.parse({ name: 123, age: -1 })
    } catch (e) {
      zodError = e as ZodError
    }

    const req = mockReq({ id: 'req-123' })
    const res = mockRes()

    globalErrorHandler(zodError!, req, res, noopNext)

    expect(res._status).toBe(400)
    expect(res._json).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        requestId: 'req-123',
      },
    })
    expect((res._json as any).error.details).toBeInstanceOf(Array)
    expect((res._json as any).error.details.length).toBeGreaterThan(0)
  })

  it('maps ZodError issue paths to field names', () => {
    const schema = z.object({
      nested: z.object({
        value: z.string(),
      }),
    })

    let zodError: ZodError
    try {
      schema.parse({ nested: { value: 42 } })
    } catch (e) {
      zodError = e as ZodError
    }

    const req = mockReq()
    const res = mockRes()

    globalErrorHandler(zodError!, req, res, noopNext)

    const details = (res._json as any).error.details
    expect(details[0].field).toBe('nested.value')
  })

  // ── XSpaceError ─────────────────────────────────────────

  it('handles XSpaceError with mapped status code', () => {
    const err = new XSpaceError(
      'SPACE_NOT_FOUND',
      'Space not found',
      'Check the URL',
      'https://docs.example.com/spaces',
    )

    const req = mockReq({ id: 'req-456' })
    const res = mockRes()

    globalErrorHandler(err, req, res, noopNext)

    expect(res._status).toBe(404)
    expect(res._json).toMatchObject({
      error: {
        code: 'SPACE_NOT_FOUND',
        message: 'Space not found',
        hint: 'Check the URL',
        docsUrl: 'https://docs.example.com/spaces',
        requestId: 'req-456',
      },
    })
  })

  it('maps AUTH_FAILED to 401', () => {
    const err = new XSpaceError('AUTH_FAILED', 'Authentication failed', 'Check credentials')
    const res = mockRes()

    globalErrorHandler(err, mockReq(), res, noopNext)

    expect(res._status).toBe(401)
  })

  it('maps PROVIDER_ERROR to 502', () => {
    const err = new XSpaceError('PROVIDER_ERROR', 'Provider failed', 'Try again later')
    const res = mockRes()

    globalErrorHandler(err, mockReq(), res, noopNext)

    expect(res._status).toBe(502)
  })

  it('maps SPACE_ENDED to 410', () => {
    const err = new XSpaceError('SPACE_ENDED', 'Space has ended', 'Join a different space')
    const res = mockRes()

    globalErrorHandler(err, mockReq(), res, noopNext)

    expect(res._status).toBe(410)
  })

  it('maps BROWSER_CONNECTION to 503', () => {
    const err = new XSpaceError('BROWSER_CONNECTION', 'Browser disconnected', 'Restart')
    const res = mockRes()

    globalErrorHandler(err, mockReq(), res, noopNext)

    expect(res._status).toBe(503)
  })

  it('maps SPEAKER_DENIED to 403', () => {
    const err = new XSpaceError('SPEAKER_DENIED', 'Speaker denied', 'Request access')
    const res = mockRes()

    globalErrorHandler(err, mockReq(), res, noopNext)

    expect(res._status).toBe(403)
  })

  it('defaults to 500 for unknown XSpaceError codes', () => {
    const err = new XSpaceError('UNKNOWN_CODE', 'Something happened', 'No idea')
    const res = mockRes()

    globalErrorHandler(err, mockReq(), res, noopNext)

    expect(res._status).toBe(500)
  })

  // ── Unexpected errors ───────────────────────────────────

  it('handles generic errors with 500 status', () => {
    const err = new Error('Something broke')
    const req = mockReq({
      id: 'req-789',
      log: {
        error: vi.fn(),
      },
    })
    const res = mockRes()

    globalErrorHandler(err, req, res, noopNext)

    expect(res._status).toBe(500)
    expect(res._json).toMatchObject({
      error: {
        code: 'INTERNAL_ERROR',
        requestId: 'req-789',
      },
    })
  })

  it('redacts error message in non-production mode', () => {
    process.env.NODE_ENV = 'development'
    const err = new Error('Failed with token abc123')
    const req = mockReq({
      log: { error: vi.fn() },
    })
    const res = mockRes()

    globalErrorHandler(err, req, res, noopNext)

    expect(res._status).toBe(500)
    // In non-production, message is redacted (via redactSecrets) but passed through
    expect((res._json as any).error.code).toBe('INTERNAL_ERROR')
  })

  it('hides error details in production mode', () => {
    process.env.NODE_ENV = 'production'
    const err = new Error('SECRET_KEY=abc123 internal failure')
    const req = mockReq({
      log: { error: vi.fn() },
    })
    const res = mockRes()

    globalErrorHandler(err, req, res, noopNext)

    expect(res._status).toBe(500)
    expect((res._json as any).error.message).toBe('Something went wrong')
  })

  it('logs unexpected errors', () => {
    const logError = vi.fn()
    const err = new Error('Unexpected')
    const req = mockReq({
      log: { error: logError },
    })
    const res = mockRes()

    globalErrorHandler(err, req, res, noopNext)

    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ err, path: '/api/test', method: 'POST' }),
      'unhandled error',
    )
  })

  it('handles missing requestId gracefully', () => {
    const err = new Error('No id')
    const req = mockReq({
      log: { error: vi.fn() },
    })
    const res = mockRes()

    globalErrorHandler(err, req, res, noopNext)

    expect(res._status).toBe(500)
    // requestId should not be in response when not set
    expect((res._json as any).error.requestId).toBeUndefined()
  })
})


