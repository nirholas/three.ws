// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§80]

// =============================================================================
// Queue System — Scheduled / Cron Jobs
// =============================================================================

import type { QueueManager } from './queue-manager'
import type { CronJobDefinition, ScheduledJob } from './types'

/**
 * Default scheduled job definitions.
 *
 * Handlers are intentionally stubs — they will be wired to real logic
 * once the dependent modules (usage aggregation, session repo, audit, etc.)
 * are integrated.
 */
export const DEFAULT_SCHEDULED_JOBS: CronJobDefinition[] = [
  {
    name: 'usage-aggregation',
    cron: '*/5 * * * *', // Every 5 minutes
    description: 'Aggregate raw usage records for billing',
    handler: async () => {
      console.log('[scheduled] usage-aggregation tick')
    },
  },
  {
    name: 'stale-session-cleanup',
    cron: '*/10 * * * *', // Every 10 minutes
    description: 'Remove sessions that have been inactive beyond threshold',
    handler: async () => {
      console.log('[scheduled] stale-session-cleanup tick')
    },
  },
  {
    name: 'audit-integrity-check',
    cron: '0 * * * *', // Every hour
    description: 'Verify audit log integrity checksums',
    handler: async () => {
      console.log('[scheduled] audit-integrity-check tick')
    },
  },
  {
    name: 'retention-enforcement',
    cron: '0 2 * * *', // Daily at 2 AM UTC
    description: 'Enforce data retention policies, purge expired records',
    handler: async () => {
      console.log('[scheduled] retention-enforcement tick')
    },
  },
  {
    name: 'invoice-generation',
    cron: '0 0 1 * *', // Monthly, 1st at midnight
    description: 'Generate monthly invoices for all organizations',
    handler: async () => {
      console.log('[scheduled] invoice-generation tick')
    },
  },
  {
    name: 'health-report',
    cron: '0 8 * * 1', // Weekly, Monday 8 AM
    description: 'Generate and distribute weekly platform health report',
    handler: async () => {
      console.log('[scheduled] health-report tick')
    },
  },
]

/**
 * Registers cron / repeatable jobs on the `scheduled` queue.
 *
 * Each cron job is added as a BullMQ repeatable job so that BullMQ's
 * built-in scheduler drives the cadence. The worker for the `scheduled`
 * queue then dispatches to the matching handler.
 */
export async function registerScheduledJobs(
  manager: QueueManager,
  jobs: CronJobDefinition[] = DEFAULT_SCHEDULED_JOBS,
): Promise<void> {
  const queue = manager.getQueue('scheduled')

  for (const job of jobs) {
    // Remove any existing repeatable with same name to avoid duplicates on restart
    const existing = await queue.getRepeatableJobs()
    for (const r of existing) {
      if (r.name === job.name) {
        await queue.removeRepeatableByKey(r.key)
      }
    }

    const data: ScheduledJob = { task: job.name }
    await queue.add(job.name, data, {
      repeat: { pattern: job.cron },
    })
  }
}

/**
 * Creates the worker-side handler map from cron definitions.
 * The scheduled queue worker looks up the handler by job name.
 */
export function buildScheduledHandlerMap(
  jobs: CronJobDefinition[] = DEFAULT_SCHEDULED_JOBS,
): Map<string, (params?: Record<string, unknown>) => Promise<void>> {
  const map = new Map<string, (params?: Record<string, unknown>) => Promise<void>>()
  for (const job of jobs) {
    map.set(job.name, job.handler)
  }
  return map
}


