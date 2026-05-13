// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// API Gateway — Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiKeyService } from '../gateway/api-key-service'
import { ApiError, invalidApiKey, missingApiKey, rateLimitExceeded, insufficientScope, validationError, notFoundError, internalError } from '../gateway/errors'
import { API_SCOPES, API_VERSIONS, type AuthenticatedRequest } from '../gateway/types'
import { createVersioningMiddleware } from '../gateway/middleware/versioning'
import { createErrorHandlerMiddleware } from '../gateway/middleware/error-handler'
import { createRequestLoggerMiddleware, onRequestLog, offRequestLog, clearRequestLogHandlers, type RequestLogHandler } from '../gateway/middleware/request-logger'

// =============================================================================
// API Key Service — Static methods
// =============================================================================

describe('ApiKeyService', () => {
  describe('generateKey', () => {
    it('generates a live key with correct format', () => {
      const key = ApiKeyService.generateKey('live')
      expect(key).toMatch(/^xsa_live_[a-f0-9]{32}$/)
    })

    it('generates a test key with correct format', () => {
      const key = ApiKeyService.generateKey('test')
      expect(key).toMatch(/^xsa_test_[a-f0-9]{32}$/)
    })

    it('generates unique keys each time', () => {
      const key1 = ApiKeyService.generateKey()
      const key2 = ApiKeyService.generateKey()
      expect(key1).not.toBe(key2)
    })

    it('defaults to live environment', () => {
      const key = ApiKeyService.generateKey()
      expect(key).toMatch(/^xsa_live_/)
    })
  })

  describe('hashKey', () => {
    it('produces a SHA-256 hex digest', () => {
      const hash = ApiKeyService.hashKey('xsa_live_abcdef1234567890abcdef1234567890')
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('produces consistent hashes for the same input', () => {
      const key = 'xsa_live_abcdef1234567890abcdef1234567890'
      expect(ApiKeyService.hashKey(key)).toBe(ApiKeyService.hashKey(key))
    })

    it('produces different hashes for different inputs', () => {
      const hash1 = ApiKeyService.hashKey('xsa_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      const hash2 = ApiKeyService.hashKey('xsa_live_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
      expect(hash1).not.toBe(hash2)
    })
  })

  describe('extractPrefix', () => {
    it('extracts prefix with first 8 chars of secret', () => {
      const key = 'xsa_live_k1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6'
      const prefix = ApiKeyService.extractPrefix(key)
      expect(prefix).toBe('xsa_live_k1a2b3c4')
    })

    it('handles test environment keys', () => {
      const key = 'xsa_test_abcdef1234567890abcdef1234567890'
      const prefix = ApiKeyService.extractPrefix(key)
      expect(prefix).toBe('xsa_test_abcdef12')
    })
  })

  describe('parseKey', () => {
    it('parses a valid live key', () => {
      const key = 'xsa_live_abcdef1234567890abcdef1234567890'
      const parsed = ApiKeyService.parseKey(key)
      expect(parsed).toEqual({
        prefix: 'xsa',
        environment: 'live',
        secret: 'abcdef1234567890abcdef1234567890',
        raw: key,
      })
    })

    it('parses a valid test key', () => {
      const key = 'xsa_test_abcdef1234567890abcdef1234567890'
      const parsed = ApiKeyService.parseKey(key)
      expect(parsed).toEqual({
        prefix: 'xsa',
        environment: 'test',
        secret: 'abcdef1234567890abcdef1234567890',
        raw: key,
      })
    })

    it('returns null for invalid keys', () => {
      expect(ApiKeyService.parseKey('invalid')).toBeNull()
      expect(ApiKeyService.parseKey('sk_live_abc')).toBeNull()
      expect(ApiKeyService.parseKey('xsa_staging_abc')).toBeNull()
      expect(ApiKeyService.parseKey('xsa_live_short')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(ApiKeyService.parseKey('')).toBeNull()
    })
  })
})

// =============================================================================
// API Error — Standardized errors
// =============================================================================

describe('ApiError', () => {
  it('creates an error with all fields', () => {
    const err = new ApiError(401, 'authentication_error', 'invalid_api_key', 'Bad key', 'key')
    expect(err.statusCode).toBe(401)
    expect(err.type).toBe('authentication_error')
    expect(err.code).toBe('invalid_api_key')
    expect(err.message).toBe('Bad key')
    expect(err.param).toBe('key')
    expect(err.docUrl).toContain('invalid_api_key')
  })

  it('serializes to standardized body', () => {
    const err = new ApiError(400, 'validation_error', 'invalid_request', 'Bad input', 'name')
    const body = err.toBody('req_123')
    expect(body).toEqual({
      error: {
        type: 'validation_error',
        code: 'invalid_request',
        message: 'Bad input',
        param: 'name',
        doc_url: expect.stringContaining('invalid_request'),
      },
      request_id: 'req_123',
    })
  })

  it('defaults param to null', () => {
    const err = new ApiError(500, 'internal_error', 'server_error', 'Oops')
    const body = err.toBody('req_456')
    expect(body.error.param).toBeNull()
  })
})

describe('error factories', () => {
  it('invalidApiKey returns 401', () => {
    const err = invalidApiKey()
    expect(err.statusCode).toBe(401)
    expect(err.type).toBe('authentication_error')
    expect(err.code).toBe('invalid_api_key')
  })

  it('missingApiKey returns 401', () => {
    const err = missingApiKey()
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe('missing_api_key')
  })

  it('insufficientScope returns 403', () => {
    const err = insufficientScope('agents:write')
    expect(err.statusCode).toBe(403)
    expect(err.type).toBe('authorization_error')
    expect(err.message).toContain('agents:write')
  })

  it('rateLimitExceeded returns 429', () => {
    const err = rateLimitExceeded(60)
    expect(err.statusCode).toBe(429)
    expect(err.type).toBe('rate_limit_error')
    expect(err.message).toContain('60')
  })

  it('validationError returns 400', () => {
    const err = validationError('name is required', 'name')
    expect(err.statusCode).toBe(400)
    expect(err.param).toBe('name')
  })

  it('notFoundError returns 404', () => {
    const err = notFoundError('API key')
    expect(err.statusCode).toBe(404)
    expect(err.message).toContain('API key')
  })

  it('internalError returns 500', () => {
    const err = internalError()
    expect(err.statusCode).toBe(500)
    expect(err.type).toBe('internal_error')
  })

  it('uses custom docs base URL', () => {
    const err = invalidApiKey('https://custom.docs.com/errors')
    expect(err.docUrl).toBe('https://custom.docs.com/errors/invalid_api_key')
  })
})

// =============================================================================
// API Scopes
// =============================================================================

describe('API_SCOPES', () => {
  it('defines all required scopes', () => {
    const expectedScopes = [
      'agents:read',
      'agents:write',
      'agents:execute',
      'conversations:read',
      'conversations:write',
      'analytics:read',
      'webhooks:manage',
      'billing:read',
    ]
    for (const scope of expectedScopes) {
      expect(API_SCOPES).toHaveProperty(scope)
      expect(typeof (API_SCOPES as Record<string, string>)[scope]).toBe('string')
    }
  })
})

// =============================================================================
// API Versioning Middleware
// =============================================================================

describe('createVersioningMiddleware', () => {
  let middleware: ReturnType<typeof createVersioningMiddleware>
  let mockReq: any
  let mockRes: any
  let next: any

  beforeEach(() => {
    middleware = createVersioningMiddleware()
    mockReq = {
      url: '/v1/agents',
      headers: {},
      auth: { requestId: 'req_test', apiVersion: '' } as AuthenticatedRequest,
    }
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    }
    next = vi.fn()
  })

  it('extracts version from URL path', () => {
    mockReq.url = '/v1/agents'
    middleware(mockReq, mockRes, next)
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-API-Version', 'v1')
    expect(next).toHaveBeenCalled()
  })

  it('extracts version from X-API-Version header', () => {
    mockReq.url = '/agents'
    mockReq.headers['x-api-version'] = 'v1'
    middleware(mockReq, mockRes, next)
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-API-Version', 'v1')
    expect(next).toHaveBeenCalled()
  })

  it('defaults to v1 when no version specified', () => {
    mockReq.url = '/agents'
    middleware(mockReq, mockRes, next)
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-API-Version', 'v1')
    expect(next).toHaveBeenCalled()
  })

  it('rejects unsupported versions', () => {
    mockReq.url = '/v99/agents'
    middleware(mockReq, mockRes, next)
    expect(mockRes.status).toHaveBeenCalledWith(400)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          type: 'validation_error',
          message: expect.stringContaining('v99'),
        }),
      }),
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('URL version takes precedence over header', () => {
    mockReq.url = '/v1/agents'
    mockReq.headers['x-api-version'] = 'v2'
    middleware(mockReq, mockRes, next)
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-API-Version', 'v1')
  })

  it('injects version into auth context', () => {
    mockReq.url = '/v1/agents'
    middleware(mockReq, mockRes, next)
    expect(mockReq.auth.apiVersion).toBe('v1')
  })
})

// =============================================================================
// Error Handler Middleware
// =============================================================================

describe('createErrorHandlerMiddleware', () => {
  let errorHandler: ReturnType<typeof createErrorHandlerMiddleware>
  let mockReq: any
  let mockRes: any
  let next: any

  beforeEach(() => {
    errorHandler = createErrorHandlerMiddleware()
    mockReq = { auth: { requestId: 'req_test' } }
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      headersSent: false,
    }
    next = vi.fn()
  })

  it('converts ApiError to standardized response', () => {
    const err = invalidApiKey()
    errorHandler(err, mockReq, mockRes, next)
    expect(mockRes.status).toHaveBeenCalledWith(401)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          type: 'authentication_error',
          code: 'invalid_api_key',
        }),
        request_id: 'req_test',
      }),
    )
  })

  it('converts unknown errors to 500 internal_error', () => {
    errorHandler(new Error('boom'), mockReq, mockRes, next)
    expect(mockRes.status).toHaveBeenCalledWith(500)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          type: 'internal_error',
          code: 'internal_server_error',
        }),
      }),
    )
  })

  it('does not send response if headers already sent', () => {
    mockRes.headersSent = true
    errorHandler(new Error('boom'), mockReq, mockRes, next)
    expect(mockRes.status).not.toHaveBeenCalled()
    expect(mockRes.json).not.toHaveBeenCalled()
  })

  it('uses "unknown" request ID when auth not present', () => {
    mockReq.auth = undefined
    errorHandler(new Error('boom'), mockReq, mockRes, next)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ request_id: 'unknown' }),
    )
  })
})

// =============================================================================
// Request Logger Middleware
// =============================================================================

describe('createRequestLoggerMiddleware', () => {
  afterEach(() => {
    clearRequestLogHandlers()
  })

  it('disabled logging returns passthrough middleware', () => {
    const middleware = createRequestLoggerMiddleware({ enableRequestLogging: false })
    const next = vi.fn()
    middleware({} as any, {} as any, next)
    expect(next).toHaveBeenCalled()
  })

  it('registers and fires log handlers on response finish', () => {
    const middleware = createRequestLoggerMiddleware()
    const handler: RequestLogHandler = vi.fn()
    onRequestLog(handler)

    let finishCallback: (() => void) | null = null
    const mockRes = {
      statusCode: 200,
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'finish') finishCallback = cb
      }),
      getHeader: vi.fn().mockReturnValue(undefined),
    }
    const mockReq = {
      method: 'GET',
      url: '/v1/agents',
      headers: { 'user-agent': 'test-client' },
      auth: {
        requestId: 'req_abc',
        apiKeyPrefix: 'xsa_live_abc',
        tenant: { orgId: 'org_123' },
        apiVersion: 'v1',
        startTime: Date.now() - 50,
      },
    }
    const next = vi.fn()

    middleware(mockReq as any, mockRes as any, next)
    expect(next).toHaveBeenCalled()

    // Simulate response finish
    expect(finishCallback).toBeTruthy()
    finishCallback!()

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req_abc',
        orgId: 'org_123',
        method: 'GET',
        path: '/v1/agents',
        statusCode: 200,
        apiVersion: 'v1',
      }),
    )
  })

  it('allows removing log handlers', () => {
    const handler: RequestLogHandler = vi.fn()
    onRequestLog(handler)
    offRequestLog(handler)

    const middleware = createRequestLoggerMiddleware()
    let finishCallback: (() => void) | null = null
    const mockRes = {
      statusCode: 200,
      on: vi.fn((_: string, cb: () => void) => { finishCallback = cb }),
      getHeader: vi.fn().mockReturnValue(undefined),
    }

    middleware({ method: 'GET', url: '/', headers: {} } as any, mockRes as any, vi.fn())
    finishCallback!()

    expect(handler).not.toHaveBeenCalled()
  })
})

// =============================================================================
// API Versions Config
// =============================================================================

describe('API_VERSIONS', () => {
  it('has v1 as current', () => {
    expect(API_VERSIONS.v1).toEqual({
      version: 'v1',
      status: 'current',
    })
  })
})

// =============================================================================
// Key format round-trip
// =============================================================================

describe('API Key format round-trip', () => {
  it('generated key can be parsed back', () => {
    const key = ApiKeyService.generateKey('live')
    const parsed = ApiKeyService.parseKey(key)
    expect(parsed).not.toBeNull()
    expect(parsed!.prefix).toBe('xsa')
    expect(parsed!.environment).toBe('live')
    expect(parsed!.secret).toHaveLength(32)
  })

  it('generated key hash is consistent', () => {
    const key = ApiKeyService.generateKey()
    const hash1 = ApiKeyService.hashKey(key)
    const hash2 = ApiKeyService.hashKey(key)
    expect(hash1).toBe(hash2)
  })

  it('prefix extracted from generated key contains environment', () => {
    const key = ApiKeyService.generateKey('test')
    const prefix = ApiKeyService.extractPrefix(key)
    expect(prefix).toMatch(/^xsa_test_/)
    expect(prefix).toHaveLength(17)
  })
})


