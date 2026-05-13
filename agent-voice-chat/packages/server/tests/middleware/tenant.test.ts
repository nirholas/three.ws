// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Tests for tenant middleware — multi-tenant resolution for Express + Socket.IO
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createTenantMiddleware,
  socketTenantMiddleware,
  getSocketTenant,
} from '../../src/middleware/tenant'
import type { Request, Response, NextFunction } from 'express'
import type { Socket } from 'socket.io'
import type { TenantContext, Organization, Plan, Quotas, FeatureFlags } from 'xspace-agent/dist/tenant'

// ---------------------------------------------------------------------------
// Mock the xspace-agent/dist/tenant module
// ---------------------------------------------------------------------------

const mockResolveApiKey = vi.fn()
const mockGetOrganizationBySlug = vi.fn()
const mockGetOrganization = vi.fn()
const mockGetOrgQuotas = vi.fn()
const mockGetPlan = vi.fn()
const mockCreateFeatureFlags = vi.fn()
const mockRunWithTenant = vi.fn()

vi.mock('xspace-agent/dist/tenant', () => ({
  resolveApiKey: (...args: any[]) => mockResolveApiKey(...args),
  getOrganizationBySlug: (...args: any[]) => mockGetOrganizationBySlug(...args),
  getOrganization: (...args: any[]) => mockGetOrganization(...args),
  getOrgQuotas: (...args: any[]) => mockGetOrgQuotas(...args),
  getPlan: (...args: any[]) => mockGetPlan(...args),
  createFeatureFlags: (...args: any[]) => mockCreateFeatureFlags(...args),
  runWithTenant: (...args: any[]) => mockRunWithTenant(...args),
}))

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-test-1',
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

function makePlan(): Plan {
  return {
    tier: 'pro',
    maxAgents: 10,
    maxConcurrentSessions: 5,
    maxSessionMinutesPerMonth: 10000,
    maxApiCallsPerMinute: 500,
    features: ['basic'],
    retentionDays: 90,
    support: 'email',
    price: 4999,
  } as Plan
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
  } as Quotas
}

function makeFeatures(): FeatureFlags {
  return {
    isEnabled: (f: string) => false,
    enabled: () => [],
  } as FeatureFlags
}

function setupResolveApiKey(org: Organization) {
  mockResolveApiKey.mockReturnValue({
    org,
    apiKey: { createdBy: 'user-1' },
  })
  mockGetPlan.mockReturnValue(makePlan())
  mockGetOrgQuotas.mockReturnValue(makeQuotas())
  mockCreateFeatureFlags.mockReturnValue(makeFeatures())
  mockRunWithTenant.mockImplementation((_ctx: unknown, fn: () => any) => fn())
}

function setupResolveSlug(org: Organization) {
  mockGetOrganizationBySlug.mockReturnValue(org)
  mockGetPlan.mockReturnValue(makePlan())
  mockGetOrgQuotas.mockReturnValue(makeQuotas())
  mockCreateFeatureFlags.mockReturnValue(makeFeatures())
  mockRunWithTenant.mockImplementation((_ctx: unknown, fn: () => any) => fn())
}

function setupResolveOrgId(org: Organization) {
  mockGetOrganization.mockReturnValue(org)
  mockGetPlan.mockReturnValue(makePlan())
  mockGetOrgQuotas.mockReturnValue(makeQuotas())
  mockCreateFeatureFlags.mockReturnValue(makeFeatures())
  mockRunWithTenant.mockImplementation((_ctx: unknown, fn: () => any) => fn())
}

// ---------------------------------------------------------------------------
// Mock helpers
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
// createTenantMiddleware
// =============================================================================

describe('createTenantMiddleware', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // ── Excluded paths ──────────────────────────────────────

  it('skips excluded paths (default: /health, /metrics)', () => {
    const middleware = createTenantMiddleware()
    const req = mockReq({ path: '/health' })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(mockResolveApiKey).not.toHaveBeenCalled()
  })

  it('skips custom excluded paths', () => {
    const middleware = createTenantMiddleware({ excludePaths: ['/public'] })
    const req = mockReq({ path: '/public/data' })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  // ── API key resolution ──────────────────────────────────

  it('resolves tenant from X-API-Key header', () => {
    const org = makeOrg()
    setupResolveApiKey(org)
    const middleware = createTenantMiddleware()
    const req = mockReq({
      headers: { 'x-api-key': 'valid-key' } as any,
    })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(mockResolveApiKey).toHaveBeenCalledWith('valid-key')
    expect(next).toHaveBeenCalled()
    expect(req.tenant).toBeDefined()
    expect(req.tenant!.orgId).toBe('org-test-1')
  })

  it('resolves tenant from Authorization: Bearer header', () => {
    const org = makeOrg()
    // No x-api-key header means resolveApiKey is only called once (from Bearer path)
    setupResolveApiKey(org)
    const middleware = createTenantMiddleware()
    const req = mockReq({
      headers: { authorization: 'Bearer valid-key' } as any,
    })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(mockResolveApiKey).toHaveBeenCalledWith('valid-key')
    expect(next).toHaveBeenCalled()
    expect(req.tenant).toBeDefined()
  })

  // ── Org ID header resolution ────────────────────────────

  it('resolves tenant from X-Org-Id header', () => {
    const org = makeOrg()
    setupResolveOrgId(org)
    const middleware = createTenantMiddleware()
    const req = mockReq({
      headers: { 'x-org-id': 'org-test-1' } as any,
    })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(mockGetOrganization).toHaveBeenCalledWith('org-test-1')
    expect(next).toHaveBeenCalled()
  })

  // ── Subdomain resolution ────────────────────────────────

  it('resolves tenant from subdomain', () => {
    const org = makeOrg({ slug: 'acme' })
    setupResolveSlug(org)
    const middleware = createTenantMiddleware()
    const req = mockReq({
      headers: { host: 'acme.xspaceagent.com' } as any,
    })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(mockGetOrganizationBySlug).toHaveBeenCalledWith('acme')
    expect(next).toHaveBeenCalled()
  })

  it('ignores common non-tenant subdomains (www, api, app, admin)', () => {
    const middleware = createTenantMiddleware()

    for (const subdomain of ['www', 'api', 'app', 'admin']) {
      const req = mockReq({
        headers: { host: `${subdomain}.xspaceagent.com` } as any,
      })
      const res = mockRes()
      const next = vi.fn()

      middleware(req, res, next)

      expect(mockGetOrganizationBySlug).not.toHaveBeenCalled()
    }
  })

  it('ignores localhost and IP addresses for subdomain resolution', () => {
    const middleware = createTenantMiddleware()

    const req = mockReq({
      headers: { host: 'localhost:3000' } as any,
    })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(mockGetOrganizationBySlug).not.toHaveBeenCalled()
  })

  // ── Query param resolution ──────────────────────────────

  it('resolves tenant from ?org query param when allowQueryParam is true', () => {
    const org = makeOrg()
    setupResolveSlug(org)
    const middleware = createTenantMiddleware({ allowQueryParam: true })
    const req = mockReq({
      query: { org: 'test-org' },
    })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(mockGetOrganizationBySlug).toHaveBeenCalledWith('test-org')
    expect(next).toHaveBeenCalled()
  })

  it('does NOT resolve from query param when allowQueryParam is false (default)', () => {
    const middleware = createTenantMiddleware()
    const req = mockReq({
      query: { org: 'test-org' },
    })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(res._status).toBe(401) // no tenant resolved
  })

  // ── No tenant resolved ──────────────────────────────────

  it('returns 401 when no tenant can be resolved', () => {
    mockResolveApiKey.mockReturnValue(undefined)
    mockGetOrganization.mockReturnValue(undefined)
    mockGetOrganizationBySlug.mockReturnValue(undefined)

    const middleware = createTenantMiddleware()
    const req = mockReq()
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(401)
    expect(res._json).toMatchObject({
      error: 'Tenant context required',
    })
  })

  // ── Deleted org ─────────────────────────────────────────

  it('rejects deleted organizations via API key', () => {
    // resolveApiKey returns a result but org is deleted
    // The internal resolveFromApiKey check filters it out → tenant = null → 401
    mockResolveApiKey.mockReturnValue({
      org: makeOrg({ status: 'deleted' }),
      apiKey: { createdBy: 'user-1' },
    })
    mockGetOrganization.mockReturnValue(undefined)
    mockGetOrganizationBySlug.mockReturnValue(undefined)

    const middleware = createTenantMiddleware()
    const req = mockReq({
      headers: { 'x-api-key': 'some-key' } as any,
    })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(401)
  })

  // ── Suspended org ───────────────────────────────────────

  it('returns 402 for suspended org with non_payment reason', () => {
    const org = makeOrg({ status: 'suspended', suspensionReason: 'non_payment' })
    setupResolveApiKey(org)
    const middleware = createTenantMiddleware()
    const req = mockReq({
      headers: { 'x-api-key': 'valid-key' } as any,
    })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(402)
    expect(res._json).toMatchObject({
      error: 'Organization suspended',
      reason: 'non_payment',
    })
  })

  it('returns 403 for suspended org with abuse reason', () => {
    const org = makeOrg({ status: 'suspended', suspensionReason: 'abuse' })
    setupResolveApiKey(org)
    const middleware = createTenantMiddleware()
    const req = mockReq({
      headers: { 'x-api-key': 'valid-key' } as any,
    })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res._status).toBe(403)
    expect(res._json).toMatchObject({
      error: 'Organization suspended',
      reason: 'abuse',
    })
  })

  // ── runWithTenant ───────────────────────────────────────

  it('wraps next() call in runWithTenant context', () => {
    const org = makeOrg()
    setupResolveApiKey(org)
    const middleware = createTenantMiddleware()
    const req = mockReq({
      headers: { 'x-api-key': 'valid-key' } as any,
    })
    const res = mockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(mockRunWithTenant).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-test-1' }),
      expect.any(Function),
    )
    expect(next).toHaveBeenCalled()
  })
})

// =============================================================================
// socketTenantMiddleware
// =============================================================================

describe('socketTenantMiddleware', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('resolves tenant from socket.handshake.auth.apiKey', () => {
    const org = makeOrg()
    setupResolveApiKey(org)
    const middleware = socketTenantMiddleware()
    const socket = mockSocket({ apiKey: 'valid-key' })
    const next = vi.fn()

    middleware(socket, next)

    expect(mockResolveApiKey).toHaveBeenCalledWith('valid-key')
    expect(next).toHaveBeenCalledWith() // no error
    expect((socket as any).tenant).toBeDefined()
    expect((socket as any).tenant.orgId).toBe('org-test-1')
  })

  it('resolves tenant from x-api-key header', () => {
    const org = makeOrg()
    setupResolveApiKey(org)
    const middleware = socketTenantMiddleware()
    const socket = mockSocket({}, { 'x-api-key': 'valid-key' })
    const next = vi.fn()

    middleware(socket, next)

    expect(next).toHaveBeenCalledWith()
    expect((socket as any).tenant).toBeDefined()
  })

  it('resolves tenant from socket.handshake.auth.orgId', () => {
    const org = makeOrg()
    mockResolveApiKey.mockReturnValue(undefined) // no API key
    setupResolveOrgId(org)
    const middleware = socketTenantMiddleware()
    const socket = mockSocket({ orgId: 'org-test-1' })
    const next = vi.fn()

    middleware(socket, next)

    expect(mockGetOrganization).toHaveBeenCalledWith('org-test-1')
    expect(next).toHaveBeenCalledWith()
  })

  it('returns error when no tenant can be resolved', () => {
    mockResolveApiKey.mockReturnValue(undefined)
    mockGetOrganization.mockReturnValue(undefined)
    const middleware = socketTenantMiddleware()
    const socket = mockSocket()
    const next = vi.fn()

    middleware(socket, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
    expect((next.mock.calls[0][0] as Error).message).toContain('Tenant context required')
  })

  it('returns error for suspended organization', () => {
    const org = makeOrg({ status: 'suspended', suspensionReason: 'abuse' })
    setupResolveApiKey(org)
    const middleware = socketTenantMiddleware()
    const socket = mockSocket({ apiKey: 'valid-key' })
    const next = vi.fn()

    middleware(socket, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
    expect((next.mock.calls[0][0] as Error).message).toContain('suspended')
  })
})

// =============================================================================
// getSocketTenant
// =============================================================================

describe('getSocketTenant', () => {
  it('returns tenant context from socket', () => {
    const socket = mockSocket()
    const tenant = {
      orgId: 'org-1',
      plan: makePlan(),
      quotas: makeQuotas(),
      features: makeFeatures(),
      org: makeOrg(),
    } as TenantContext
    ;(socket as any).tenant = tenant

    const result = getSocketTenant(socket)

    expect(result).toBe(tenant)
    expect(result.orgId).toBe('org-1')
  })

  it('throws when no tenant is set on socket', () => {
    const socket = mockSocket()

    expect(() => getSocketTenant(socket)).toThrow(
      'No tenant context on socket',
    )
  })
})


