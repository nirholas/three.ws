// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Test App Helper — Minimal Express app factory for route testing
// =============================================================================

import express, { type Express, type Request, type Response, type NextFunction } from 'express'
import type { TenantContext } from 'xspace-agent/dist/tenant'

// ---------------------------------------------------------------------------
// Default mock tenant for authenticated routes
// ---------------------------------------------------------------------------

export function createMockTenant(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    orgId: 'org-test-123',
    userId: 'user-test-456',
    plan: {
      tier: 'pro',
      maxAgents: 10,
      maxConcurrentSessions: 5,
      maxSessionMinutesPerMonth: 10000,
      maxApiCallsPerMinute: 600,
      features: ['analytics', 'multi-agent', 'custom-voices'],
      retentionDays: 90,
      support: 'email',
      price: 9900,
    },
    quotas: {
      maxAgents: 10,
      currentAgents: 2,
      maxConcurrentSessions: 5,
      currentSessions: 1,
      maxSessionMinutesPerMonth: 10000,
      usedSessionMinutes: 500,
      maxApiCallsPerMinute: 600,
    },
    features: {
      isEnabled: (f: string) => ['analytics', 'multi-agent', 'custom-voices'].includes(f),
      enabled: () => ['analytics', 'multi-agent', 'custom-voices'],
    },
    org: {
      id: 'org-test-123',
      name: 'Test Org',
      slug: 'test-org',
      ownerId: 'user-test-456',
      plan: 'pro',
      status: 'active',
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-06-01'),
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

export interface CreateTestAppOptions {
  /** Inject a tenant into every request. Set to `null` to simulate unauthenticated. */
  tenant?: TenantContext | null
}

/**
 * Creates a minimal Express app with JSON body parsing and optional
 * tenant injection middleware. Use this to mount route routers under test.
 */
export function createTestApp(options: CreateTestAppOptions = {}): Express {
  const app = express()

  app.use(express.json())

  // Inject tenant context (simulates the tenant middleware)
  const tenant = options.tenant === undefined ? createMockTenant() : options.tenant
  if (tenant !== null) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.tenant = tenant
      next()
    })
  }

  return app
}


