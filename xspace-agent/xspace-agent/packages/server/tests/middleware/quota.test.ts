// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Tests for quota middleware — rate limiting + usage quota enforcement
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createQuotaMiddleware,
  createSessionQuotaMiddleware,
} from '../../src/middleware/quota'
import type { Request, Response, NextFunction } from 'express'
import type { TenantContext, Plan, Quotas, FeatureFlags, Organization } from 'xspace-agent'

// ---------------------------------------------------------------------------
// Mock the xspace-agent billing imports
// ---------------------------------------------------------------------------

vi.mock('xspace-agent', async () => {
  const actual = await vi.importActual('xspace-agent')
  return {
    ...actual as any,
    UsageTracker: vi.fn(),
    RATE_LIMITS_BY_PLAN: {
      free: 10,
      developer: 100,
      pro: 500,
      business: 2000,
      enterprise: 10000,
    },
    ENDPOINT_GROUP_LIMITS: {
      agents: 0.5,
      conversations: 0.3,
      billing: 10,
    },
  }
})

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePlan(tier: string = 'pro'): Plan {
  return {
    tier: tier as any,
    maxAgents: 10,
    maxConcurrentSessions: 5,
    maxSessionMinutesPerMonth: 10000,
    maxApiCallsPerMinute: 500,
    features: ['basic'],
    retentionDays: 90,
    support: 'email',
    price: 4999,
  }
}

function makeQuotas(): Quotas {
  return {
    maxAgents: 10,
    currentAgents: 2,
    maxConcurrentSessions: 5,
    currentSessions: 1,
    maxSessionMinutesPerMonth: 10000,
    usedSessionMinutes: 500,
    maxApiCallsPerMinute: 500,
  }
}

function makeFeatureFlags(): FeatureFlags {
  return {
    isEnabled: (f: string) => false,
    enabled: () => [],
  }
}

function makeOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    name: 'Test Org',
    slug: 'test-org',
    ownerId: 'user-1',
    plan: 'pro',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Organization
}

function makeTenantContext(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    orgId: 'org-1',
    userId: 'user-1',
    plan: makePlan(),
    quotas: makeQuotas(),
    features: makeFeatureFlags(),
    org: makeOrg(),
    ...overrides,
  } as TenantContext
}

// ---------------------------------------------------------------------------
// Mock UsageTracker
// ---------------------------------------------------------------------------

function createMockTracker(overrides: Record<string, any> = {}) {
  return {
    checkRateLimit: vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 100,
      resetAt: Date.now() + 60000,
    }),
    checkQuota: vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 5000,
      limit: 10000,
      used: 5000,
      resetAt: new Date(),
    }),
    trackAPICall: vi.fn().mockResolvedValue(undefined),
    getActiveSessions: vi.fn().mockResolvedValue(1),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Mock req/res
// ---------------------------------------------------------------------------

function mockReq(
  path: string = '/api/test',
  tenant?: TenantContext,
): Request {
  return {
    path,
    tenant,
    ip: '127.0.0.1',
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
// createQuotaMiddleware
// =============================================================================

describe('createQuotaMiddleware', () => {
  // ── Skip paths ──────────────────────────────────────────

  it('skips excluded paths (default: /health, /metrics)', async () => {
    const tracker = createMockTracker()
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/health')
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(tracker.checkRateLimit).not.toHaveBeenCalled()
  })

  it('skips custom excluded paths', async () => {
    const tracker = createMockTracker()
    const middleware = createQuotaMiddleware({
      tracker: tracker as any,
      skipPaths: ['/public'],
    })
    const req = mockReq('/public')
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(tracker.checkRateLimit).not.toHaveBeenCalled()
  })

  // ── No tenant context ───────────────────────────────────

  it('passes through when no tenant context is set', async () => {
    const tracker = createMockTracker()
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/test', undefined)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(tracker.checkRateLimit).not.toHaveBeenCalled()
  })

  // ── Rate limit check ───────────────────────────────────

  it('allows request when within rate limit', async () => {
    const tracker = createMockTracker()
    const tenant = makeTenantContext()
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/test', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res._headers['X-RateLimit-Limit']).toBeDefined()
    expect(res._headers['X-RateLimit-Remaining']).toBeDefined()
    expect(res._headers['X-RateLimit-Reset']).toBeDefined()
  })

  it('returns 429 when rate limit is exceeded', async () => {
    const tracker = createMockTracker({
      checkRateLimit: vi.fn().mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30000,
      }),
    })
    const tenant = makeTenantContext()
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/test', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(429)
    expect(res._json).toMatchObject({
      error: 'Rate limit exceeded',
    })
    expect(res._headers['Retry-After']).toBeDefined()
    expect(res._json).toHaveProperty('hint')
  })

  it('sets rate limit headers on all responses', async () => {
    const tracker = createMockTracker({
      checkRateLimit: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 42,
        resetAt: Date.now() + 60000,
      }),
    })
    const tenant = makeTenantContext()
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/test', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(res._headers['X-RateLimit-Remaining']).toBe('42')
  })

  // ── Monthly quota check ─────────────────────────────────

  it('returns 402 when monthly session quota is exceeded', async () => {
    const tracker = createMockTracker({
      checkQuota: vi.fn().mockResolvedValue({
        allowed: false,
        remaining: 0,
        limit: 10000,
        used: 10000,
        resetAt: new Date('2026-04-01T00:00:00Z'),
      }),
    })
    const tenant = makeTenantContext()
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/test', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(402)
    expect(res._json).toMatchObject({
      error: 'Monthly session minute quota exceeded',
      used: 10000,
      limit: 10000,
    })
  })

  // ── API call tracking ───────────────────────────────────

  it('tracks API call fire-and-forget after passing checks', async () => {
    const tracker = createMockTracker()
    const tenant = makeTenantContext()
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/agents/list', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(tracker.trackAPICall).toHaveBeenCalledWith('org-1', '/agents/list')
  })

  // ── Endpoint group limits ───────────────────────────────

  it('uses agents endpoint group rate limit for /agents paths', async () => {
    const tracker = createMockTracker()
    const tenant = makeTenantContext()
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/agents/list', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    // pro plan = 500, agents = 0.5 * 500 = 250
    expect(tracker.checkRateLimit).toHaveBeenCalledWith('org-1', 250)
  })

  it('uses conversations endpoint group rate limit', async () => {
    const tracker = createMockTracker()
    const tenant = makeTenantContext()
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/conversations/list', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    // pro plan = 500, conversations = 0.3 * 500 = 150
    expect(tracker.checkRateLimit).toHaveBeenCalledWith('org-1', 150)
  })

  it('uses flat billing endpoint group limit', async () => {
    const tracker = createMockTracker()
    const tenant = makeTenantContext()
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/billing/invoices', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    // billing = flat 10 req/min for all plans
    expect(tracker.checkRateLimit).toHaveBeenCalledWith('org-1', 10)
  })

  it('uses full org rate limit for non-grouped paths', async () => {
    const tracker = createMockTracker()
    const tenant = makeTenantContext()
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/other', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    // pro plan = 500, no group = full limit
    expect(tracker.checkRateLimit).toHaveBeenCalledWith('org-1', 500)
  })

  // ── Plan tier rate limits ───────────────────────────────

  it('applies free tier rate limit', async () => {
    const tracker = createMockTracker()
    const tenant = makeTenantContext({
      plan: makePlan('free'),
    })
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/test', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(tracker.checkRateLimit).toHaveBeenCalledWith('org-1', 10)
  })

  it('applies enterprise tier rate limit', async () => {
    const tracker = createMockTracker()
    const tenant = makeTenantContext({
      plan: makePlan('enterprise'),
    })
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/test', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(tracker.checkRateLimit).toHaveBeenCalledWith('org-1', 10000)
  })

  it('falls back to free tier for unknown plan', async () => {
    const tracker = createMockTracker()
    const tenant = makeTenantContext({
      plan: makePlan('unknown-plan'),
    })
    const middleware = createQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/test', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(tracker.checkRateLimit).toHaveBeenCalledWith('org-1', 10)
  })
})

// =============================================================================
// createSessionQuotaMiddleware
// =============================================================================

describe('createSessionQuotaMiddleware', () => {
  it('passes through when no tenant context is set', async () => {
    const tracker = createMockTracker()
    const middleware = createSessionQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/sessions/start', undefined)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(tracker.getActiveSessions).not.toHaveBeenCalled()
  })

  it('allows session when under concurrent limit', async () => {
    const tracker = createMockTracker({
      getActiveSessions: vi.fn().mockResolvedValue(2),
    })
    const tenant = makeTenantContext()
    const middleware = createSessionQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/sessions/start', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(tracker.getActiveSessions).toHaveBeenCalledWith('org-1')
  })

  it('returns 429 when concurrent session limit is reached', async () => {
    const tracker = createMockTracker({
      getActiveSessions: vi.fn().mockResolvedValue(5),
    })
    const tenant = makeTenantContext()
    // maxConcurrentSessions = 5 in default plan
    const middleware = createSessionQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/sessions/start', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(429)
    expect(res._json).toMatchObject({
      error: 'Concurrent session limit reached',
      current: 5,
      limit: 5,
    })
  })

  it('returns 429 when exceeding concurrent session limit', async () => {
    const tracker = createMockTracker({
      getActiveSessions: vi.fn().mockResolvedValue(10),
    })
    const tenant = makeTenantContext()
    const middleware = createSessionQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/sessions/start', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(429)
    expect(res._json).toHaveProperty('hint')
  })

  it('allows session when at limit minus one', async () => {
    const tracker = createMockTracker({
      getActiveSessions: vi.fn().mockResolvedValue(4),
    })
    const tenant = makeTenantContext()
    // maxConcurrentSessions = 5
    const middleware = createSessionQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/sessions/start', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('uses plan maxConcurrentSessions for the limit', async () => {
    const tracker = createMockTracker({
      getActiveSessions: vi.fn().mockResolvedValue(1),
    })
    const tenant = makeTenantContext({
      plan: { ...makePlan(), maxConcurrentSessions: 1 },
    })
    const middleware = createSessionQuotaMiddleware({ tracker: tracker as any })
    const req = mockReq('/api/sessions/start', tenant)
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(429)
    expect((res._json as any).limit).toBe(1)
  })
})


