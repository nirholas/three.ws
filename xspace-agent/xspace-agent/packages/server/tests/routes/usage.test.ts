// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§80]

// =============================================================================
// Tests — Usage Routes (createUsageRoutes)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp, createMockTenant } from '../helpers/test-app'
import { createUsageRoutes } from '../../src/routes/usage'

// ---------------------------------------------------------------------------
// Mock xspace-agent imports
// ---------------------------------------------------------------------------

const mockGetUsageSummary = vi.fn()
const mockGetActiveSessions = vi.fn()
const mockAggregateByOrg = vi.fn()
const mockFindByOrgId = vi.fn()

vi.mock('xspace-agent', () => ({
  UsageTracker: vi.fn(),
  UsageRepository: vi.fn().mockImplementation(function (this: any) {
    this.aggregateByOrg = mockAggregateByOrg
    this.findByOrgId = mockFindByOrgId
  }),
  getQuotaLimit: vi.fn((_tier: string, metric: string) => {
    const limits: Record<string, number> = {
      session_minutes: 10000,
      llm_input_tokens: 1000000,
      llm_output_tokens: 500000,
      stt_minutes: 5000,
      tts_characters: 2000000,
      api_calls: 100000,
      webhook_deliveries: 50000,
    }
    return limits[metric] ?? Infinity
  }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockTracker() {
  return {
    getUsageSummary: mockGetUsageSummary,
    getActiveSessions: mockGetActiveSessions,
  }
}

function buildApp(tenantOverride?: Parameters<typeof createMockTenant>[0] | null) {
  const tenant = tenantOverride === null ? null : createMockTenant(tenantOverride)
  const app = createTestApp({ tenant })
  const tracker = createMockTracker()
  app.use(createUsageRoutes({ tracker: tracker as any }))
  return { app, tracker }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Usage Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── GET /usage/current ────────────────────────────────────────────────

  describe('GET /usage/current', () => {
    it('returns current usage summary with quotas', async () => {
      mockGetUsageSummary.mockResolvedValue({
        metrics: {
          session_minutes: 250,
          llm_input_tokens: 50000,
          llm_output_tokens: 20000,
          stt_minutes: 100,
          tts_characters: 30000,
          api_calls: 5000,
          webhook_deliveries: 200,
        },
        estimatedCostCents: 1500,
        period: { start: '2025-06-01', end: '2025-06-30' },
      })
      mockGetActiveSessions.mockResolvedValue(2)

      const { app } = buildApp()
      const res = await request(app).get('/usage/current')

      expect(res.status).toBe(200)
      expect(res.body.activeSessions).toBe(2)
      expect(res.body.quotas).toBeDefined()
      expect(res.body.quotas.session_minutes).toEqual(
        expect.objectContaining({ used: 250, limit: 10000 }),
      )
      expect(res.body.quotas.session_minutes.percent).toBe(3) // 250/10000 = 2.5 -> rounds to 3
    })

    it('returns 401 without tenant context', async () => {
      const { app } = buildApp(null)
      const res = await request(app).get('/usage/current')

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('Tenant context required')
    })
  })

  // ── GET /usage/history ────────────────────────────────────────────────

  describe('GET /usage/history', () => {
    it('returns historical usage for default 30 days', async () => {
      mockAggregateByOrg.mockResolvedValue({ session_minutes: 5000 })

      const { app } = buildApp()
      const res = await request(app).get('/usage/history')

      expect(res.status).toBe(200)
      expect(res.body.orgId).toBe('org-test-123')
      expect(res.body.days).toBe(30)
      expect(res.body.metrics).toEqual({ session_minutes: 5000 })
    })

    it('accepts custom days parameter (capped at 90)', async () => {
      mockAggregateByOrg.mockResolvedValue({})

      const { app } = buildApp()
      const res = await request(app).get('/usage/history?days=200')

      expect(res.status).toBe(200)
      expect(res.body.days).toBe(90) // capped
    })

    it('returns 401 without tenant context', async () => {
      const { app } = buildApp(null)
      const res = await request(app).get('/usage/history')

      expect(res.status).toBe(401)
    })
  })

  // ── GET /usage/breakdown ──────────────────────────────────────────────

  describe('GET /usage/breakdown', () => {
    it('returns per-session usage breakdown', async () => {
      mockFindByOrgId.mockResolvedValue([
        { sessionId: 'sess-1', metric: 'llm_input_tokens', quantity: 1000, unitCostCents: 5 },
        { sessionId: 'sess-1', metric: 'llm_output_tokens', quantity: 500, unitCostCents: 10 },
        { sessionId: 'sess-2', metric: 'stt_minutes', quantity: 30, unitCostCents: 3 },
      ])

      const { app } = buildApp()
      const res = await request(app).get('/usage/breakdown')

      expect(res.status).toBe(200)
      expect(res.body.orgId).toBe('org-test-123')
      expect(res.body.sessions['sess-1'].costCents).toBe(15)
      expect(res.body.sessions['sess-1'].metrics.llm_input_tokens).toBe(1000)
      expect(res.body.sessions['sess-2'].metrics.stt_minutes).toBe(30)
    })

    it('groups records without sessionId under "unattributed"', async () => {
      mockFindByOrgId.mockResolvedValue([
        { sessionId: null, metric: 'api_calls', quantity: 10, unitCostCents: 0 },
      ])

      const { app } = buildApp()
      const res = await request(app).get('/usage/breakdown')

      expect(res.status).toBe(200)
      expect(res.body.sessions.unattributed).toBeDefined()
      expect(res.body.sessions.unattributed.metrics.api_calls).toBe(10)
    })

    it('respects the limit query parameter (capped at 200)', async () => {
      mockFindByOrgId.mockResolvedValue([])

      const { app } = buildApp()
      await request(app).get('/usage/breakdown?limit=500')

      // findByOrgId should be called with capped limit of 200
      expect(mockFindByOrgId).toHaveBeenCalledWith('org-test-123', 200)
    })

    it('returns 401 without tenant context', async () => {
      const { app } = buildApp(null)
      const res = await request(app).get('/usage/breakdown')

      expect(res.status).toBe(401)
    })
  })

  // ── GET /usage/cost-estimate ──────────────────────────────────────────

  describe('GET /usage/cost-estimate', () => {
    it('returns projected month-end cost', async () => {
      mockGetUsageSummary.mockResolvedValue({
        estimatedCostCents: 3000,
        period: { start: '2025-06-01', end: '2025-06-30' },
      })

      const { app } = buildApp()
      const res = await request(app).get('/usage/cost-estimate')

      expect(res.status).toBe(200)
      expect(res.body.orgId).toBe('org-test-123')
      expect(res.body.currentCostCents).toBe(3000)
      expect(res.body.projectedCostCents).toBeGreaterThanOrEqual(3000)
      expect(res.body.daysElapsed).toBeGreaterThanOrEqual(1)
      expect(res.body.basePriceCents).toBe(9900)
    })

    it('returns 401 without tenant context', async () => {
      const { app } = buildApp(null)
      const res = await request(app).get('/usage/cost-estimate')

      expect(res.status).toBe(401)
    })
  })

  // ── GET /usage/export ─────────────────────────────────────────────────

  describe('GET /usage/export', () => {
    it('returns CSV with correct headers', async () => {
      mockFindByOrgId.mockResolvedValue([
        {
          id: 'rec-1',
          sessionId: 'sess-1',
          metric: 'llm_input_tokens',
          quantity: 5000,
          unitCostCents: 10,
          provider: 'openai',
          recordedAt: new Date('2025-06-15T12:00:00Z'),
        },
      ])

      const { app } = buildApp()
      const res = await request(app).get('/usage/export')

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/csv')
      expect(res.headers['content-disposition']).toContain('attachment')
      expect(res.headers['content-disposition']).toContain('usage-org-test-123')

      const lines = res.text.split('\n')
      expect(lines[0]).toBe('id,session_id,metric,quantity,unit_cost_cents,provider,recorded_at')
      expect(lines[1]).toContain('rec-1')
      expect(lines[1]).toContain('sess-1')
      expect(lines[1]).toContain('llm_input_tokens')
    })

    it('respects the limit query parameter (capped at 10000)', async () => {
      mockFindByOrgId.mockResolvedValue([])

      const { app } = buildApp()
      await request(app).get('/usage/export?limit=50000')

      expect(mockFindByOrgId).toHaveBeenCalledWith('org-test-123', 10000)
    })

    it('handles records with null fields gracefully', async () => {
      mockFindByOrgId.mockResolvedValue([
        {
          id: 'rec-2',
          sessionId: null,
          metric: 'api_calls',
          quantity: 1,
          unitCostCents: null,
          provider: null,
          recordedAt: null,
        },
      ])

      const { app } = buildApp()
      const res = await request(app).get('/usage/export')

      expect(res.status).toBe(200)
      const lines = res.text.split('\n')
      expect(lines).toHaveLength(2) // header + 1 row
    })

    it('returns 401 without tenant context', async () => {
      const { app } = buildApp(null)
      const res = await request(app).get('/usage/export')

      expect(res.status).toBe(401)
    })
  })
})


