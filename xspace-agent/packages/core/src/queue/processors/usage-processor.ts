// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// =============================================================================
// Queue Processor — Usage Aggregation
// =============================================================================

import type { Job } from 'bullmq'
import type { UsageAggregationJob } from '../types'

/**
 * Aggregates raw usage records for a given org and time period,
 * then stores the aggregate for billing / Stripe reporting.
 */
export async function usageProcessor(job: Job<UsageAggregationJob>): Promise<{ recordsProcessed: number }> {
  const { orgId, periodStart, periodEnd, metrics } = job.data

  // Import lazily to avoid circular dependency at module load time
  const { UsageRepository } = await import('../../db')

  const repo = new UsageRepository()
  const start = new Date(periodStart)
  const end = new Date(periodEnd)

  const records = await repo.getByOrgAndPeriod(orgId, start, end)
  if (records.length === 0) {
    return { recordsProcessed: 0 }
  }

  // Build aggregates per metric
  const aggregates: Record<string, number> = {}
  for (const record of records) {
    const metric = record.metric
    if (metrics.length > 0 && !metrics.includes(metric)) continue
    aggregates[metric] = (aggregates[metric] ?? 0) + Number(record.quantity)
  }

  // Persist the aggregate
  for (const [metric, quantity] of Object.entries(aggregates)) {
    await repo.createAggregate({
      orgId,
      metric,
      quantity,
      periodStart: start,
      periodEnd: end,
    })
  }

  return { recordsProcessed: records.length }
}


