// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Usage Dashboard Routes — Real-time usage, history, and cost projections
// =============================================================================

import { Router, type Request, type Response } from 'express'
import { UsageTracker, getQuotaLimit } from 'xspace-agent'
import type { UsageMetric } from 'xspace-agent'
import { UsageRepository } from 'xspace-agent'

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export interface UsageRoutesConfig {
  tracker: UsageTracker
}

export function createUsageRoutes(config: UsageRoutesConfig): Router {
  const router = Router()
  const { tracker } = config
  const usageRepo = new UsageRepository()

  // ── GET /usage/current — Current billing period summary ────

  router.get('/usage/current', async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json({ error: 'Tenant context required' })
      return
    }

    const summary = await tracker.getUsageSummary(tenant.orgId)
    const activeSessions = await tracker.getActiveSessions(tenant.orgId)

    // Add quota limits for each metric
    const quotas: Record<string, { used: number; limit: number; percent: number }> = {}
    const metrics: UsageMetric[] = [
      'session_minutes', 'llm_input_tokens', 'llm_output_tokens',
      'stt_minutes', 'tts_characters', 'api_calls', 'webhook_deliveries',
    ]
    for (const metric of metrics) {
      const limit = getQuotaLimit(tenant.plan.tier, metric)
      const used = summary.metrics[metric] ?? 0
      quotas[metric] = {
        used,
        limit: limit === Infinity ? -1 : limit, // -1 signals unlimited
        percent: limit === Infinity ? 0 : Math.round((used / limit) * 100),
      }
    }

    res.json({
      ...summary,
      activeSessions,
      maxConcurrentSessions: tenant.plan.maxConcurrentSessions,
      quotas,
    })
  })

  // ── GET /usage/history — Historical usage (30/60/90 days) ──

  router.get('/usage/history', async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json({ error: 'Tenant context required' })
      return
    }

    const days = Math.min(Number(req.query.days) || 30, 90)
    const since = new Date()
    since.setDate(since.getDate() - days)

    const aggregates = await usageRepo.aggregateByOrg(tenant.orgId, since)

    res.json({
      orgId: tenant.orgId,
      days,
      since: since.toISOString(),
      metrics: aggregates,
    })
  })

  // ── GET /usage/breakdown — Per-session breakdown ───────────

  router.get('/usage/breakdown', async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json({ error: 'Tenant context required' })
      return
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const records = await usageRepo.findByOrgId(tenant.orgId, limit)

    // Group by session
    const bySession: Record<string, { metrics: Record<string, number>; costCents: number }> = {}
    for (const record of records) {
      const sid = record.sessionId ?? 'unattributed'
      if (!bySession[sid]) {
        bySession[sid] = { metrics: {}, costCents: 0 }
      }
      bySession[sid].metrics[record.metric] =
        (bySession[sid].metrics[record.metric] ?? 0) + Number(record.quantity)
      bySession[sid].costCents += Number(record.unitCostCents ?? 0)
    }

    res.json({
      orgId: tenant.orgId,
      sessions: bySession,
    })
  })

  // ── GET /usage/cost-estimate — Projected month-end cost ────

  router.get('/usage/cost-estimate', async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json({ error: 'Tenant context required' })
      return
    }

    const summary = await tracker.getUsageSummary(tenant.orgId)

    // Project based on days elapsed vs days in month
    const now = new Date()
    const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate()
    const daysElapsed = Math.max(1, now.getUTCDate())
    const projectionMultiplier = daysInMonth / daysElapsed

    const projectedCostCents = Math.round(summary.estimatedCostCents * projectionMultiplier)

    res.json({
      orgId: tenant.orgId,
      period: summary.period,
      currentCostCents: summary.estimatedCostCents,
      projectedCostCents,
      daysElapsed,
      daysInMonth,
      basePriceCents: tenant.plan.price ?? 0,
      projectedTotalCents: (tenant.plan.price ?? 0) + projectedCostCents,
    })
  })

  // ── GET /usage/export — CSV export of usage records ────────

  router.get('/usage/export', async (req: Request, res: Response) => {
    const tenant = req.tenant
    if (!tenant) {
      res.status(401).json({ error: 'Tenant context required' })
      return
    }

    const limit = Math.min(Number(req.query.limit) || 1000, 10000)
    const records = await usageRepo.findByOrgId(tenant.orgId, limit)

    const header = 'id,session_id,metric,quantity,unit_cost_cents,provider,recorded_at'
    const rows = records.map((r) =>
      [r.id, r.sessionId ?? '', r.metric, r.quantity, r.unitCostCents ?? 0, r.provider ?? '', r.recordedAt?.toISOString() ?? ''].join(','),
    )

    res.set('Content-Type', 'text/csv')
    res.set('Content-Disposition', `attachment; filename="usage-${tenant.orgId}-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send([header, ...rows].join('\n'))
  })

  return router
}


