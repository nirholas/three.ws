// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Usage Tracker — Real-Time Usage Metering with Redis + PostgreSQL
// =============================================================================

import { getRedis } from '../db/redis'
import { UsageRepository, type NewUsageRecord } from '../db/repositories/usage'
import { CostTracker } from '../providers/cost-tracker'
import type { UsageMetric, QuotaResult, UsageSummary, AlertThreshold } from './types'
import { DEFAULT_ALERT_THRESHOLDS } from './types'

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

function periodKey(orgId: string): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function usageKey(orgId: string, metric: UsageMetric, period: string): string {
  return `usage:${orgId}:${metric}:${period}`
}

function rateKey(orgId: string, bucket: string): string {
  return `rate:${orgId}:api:${bucket}`
}

function sessionsKey(orgId: string): string {
  return `rate:${orgId}:sessions`
}

function costKey(orgId: string, period: string): string {
  return `cost:${orgId}:${period}`
}

function alertKey(orgId: string, metric: string, percent: number): string {
  return `alert:${orgId}:${metric}:${percent}`
}

function minuteBucket(): string {
  return String(Math.floor(Date.now() / 60_000))
}

// ---------------------------------------------------------------------------
// Quota limits per metric per plan
// ---------------------------------------------------------------------------

interface PlanQuotas {
  session_minutes: number
  llm_input_tokens: number
  llm_output_tokens: number
  stt_minutes: number
  tts_characters: number
  api_calls: number
  storage_gb: number
  webhook_deliveries: number
}

const PLAN_QUOTAS: Record<string, PlanQuotas> = {
  free: {
    session_minutes: 60,
    llm_input_tokens: 1_000_000,
    llm_output_tokens: 500_000,
    stt_minutes: 30,
    tts_characters: 50_000,
    api_calls: 10_000,
    storage_gb: 1,
    webhook_deliveries: 0,
  },
  developer: {
    session_minutes: 1_000,
    llm_input_tokens: 10_000_000,
    llm_output_tokens: 5_000_000,
    stt_minutes: 500,
    tts_characters: 500_000,
    api_calls: 100_000,
    storage_gb: 10,
    webhook_deliveries: 10_000,
  },
  pro: {
    session_minutes: 10_000,
    llm_input_tokens: 100_000_000,
    llm_output_tokens: 50_000_000,
    stt_minutes: 5_000,
    tts_characters: 5_000_000,
    api_calls: 1_000_000,
    storage_gb: 100,
    webhook_deliveries: 100_000,
  },
  business: {
    session_minutes: 100_000,
    llm_input_tokens: 1_000_000_000,
    llm_output_tokens: 500_000_000,
    stt_minutes: 50_000,
    tts_characters: 50_000_000,
    api_calls: 10_000_000,
    storage_gb: 1_000,
    webhook_deliveries: 1_000_000,
  },
  enterprise: {
    session_minutes: Infinity,
    llm_input_tokens: Infinity,
    llm_output_tokens: Infinity,
    stt_minutes: Infinity,
    tts_characters: Infinity,
    api_calls: Infinity,
    storage_gb: Infinity,
    webhook_deliveries: Infinity,
  },
}

/** Get quota limits for a plan tier and metric. */
export function getQuotaLimit(plan: string, metric: UsageMetric): number {
  const quotas = PLAN_QUOTAS[plan]
  if (!quotas) return 0
  return quotas[metric] ?? 0
}

// ---------------------------------------------------------------------------
// Flush buffer — batches Redis counter writes to PostgreSQL
// ---------------------------------------------------------------------------

interface PendingRecord {
  orgId: string
  sessionId?: string
  metric: UsageMetric
  quantity: number
  unitCostCents: number
  provider?: string
}

// ---------------------------------------------------------------------------
// UsageTracker
// ---------------------------------------------------------------------------

export interface UsageTrackerConfig {
  /** How often to flush accumulated usage to PostgreSQL (ms). Default: 30_000. */
  flushIntervalMs?: number
  /** Alert thresholds. Default: 50%, 75%, 90%, 100%. */
  alertThresholds?: AlertThreshold[]
  /** Callback when an alert threshold is crossed. */
  onAlert?: (orgId: string, metric: UsageMetric, percent: number, threshold: AlertThreshold) => void
}

export class UsageTracker {
  private usageRepo = new UsageRepository()
  private pendingRecords: PendingRecord[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private alertThresholds: AlertThreshold[]
  private onAlert?: UsageTrackerConfig['onAlert']

  constructor(config: UsageTrackerConfig = {}) {
    const flushInterval = config.flushIntervalMs ?? 30_000
    this.alertThresholds = config.alertThresholds ?? DEFAULT_ALERT_THRESHOLDS
    this.onAlert = config.onAlert

    this.flushTimer = setInterval(() => this.flush(), flushInterval)
    this.flushTimer.unref()
  }

  // ── Track usage ────────────────────────────────────────────

  /** Track LLM token usage. */
  async trackLLMUsage(
    orgId: string,
    sessionId: string,
    provider: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    const period = periodKey(orgId)
    const redis = getRedis()

    const pipeline = redis.pipeline()
    pipeline.incrby(usageKey(orgId, 'llm_input_tokens', period), inputTokens)
    pipeline.incrby(usageKey(orgId, 'llm_output_tokens', period), outputTokens)

    // Accumulate estimated cost in cents
    const costUSD = CostTracker.estimateLLMCost(provider, inputTokens, outputTokens)
    const costCents = Math.round(costUSD * 100)
    pipeline.incrbyfloat(costKey(orgId, period), costCents)

    await pipeline.exec()

    this.pendingRecords.push(
      { orgId, sessionId, metric: 'llm_input_tokens', quantity: inputTokens, unitCostCents: 0, provider },
      { orgId, sessionId, metric: 'llm_output_tokens', quantity: outputTokens, unitCostCents: costCents, provider },
    )
  }

  /** Track STT audio duration. */
  async trackSTTUsage(
    orgId: string,
    sessionId: string,
    provider: string,
    durationMs: number,
  ): Promise<void> {
    const period = periodKey(orgId)
    const redis = getRedis()
    const minutes = Math.ceil(durationMs / 60_000)

    const pipeline = redis.pipeline()
    pipeline.incrby(usageKey(orgId, 'stt_minutes', period), minutes)

    const costUSD = CostTracker.estimateSTTCost(provider, durationMs / 1000)
    const costCents = Math.round(costUSD * 100)
    pipeline.incrbyfloat(costKey(orgId, period), costCents)

    await pipeline.exec()

    this.pendingRecords.push({
      orgId, sessionId, metric: 'stt_minutes', quantity: minutes, unitCostCents: costCents, provider,
    })
  }

  /** Track TTS character usage. */
  async trackTTSUsage(
    orgId: string,
    sessionId: string,
    provider: string,
    characters: number,
  ): Promise<void> {
    const period = periodKey(orgId)
    const redis = getRedis()

    const pipeline = redis.pipeline()
    pipeline.incrby(usageKey(orgId, 'tts_characters', period), characters)

    const costUSD = CostTracker.estimateTTSCost(provider, characters)
    const costCents = Math.round(costUSD * 100)
    pipeline.incrbyfloat(costKey(orgId, period), costCents)

    await pipeline.exec()

    this.pendingRecords.push({
      orgId, sessionId, metric: 'tts_characters', quantity: characters, unitCostCents: costCents, provider,
    })
  }

  /** Track a session minute (call every minute while session is active). */
  async trackSessionMinute(orgId: string, sessionId: string): Promise<void> {
    const period = periodKey(orgId)
    const redis = getRedis()
    await redis.incrby(usageKey(orgId, 'session_minutes', period), 1)

    this.pendingRecords.push({
      orgId, sessionId, metric: 'session_minutes', quantity: 1, unitCostCents: 0,
    })
  }

  /** Track an API call. */
  async trackAPICall(orgId: string, endpoint: string): Promise<void> {
    const period = periodKey(orgId)
    const redis = getRedis()
    await redis.incrby(usageKey(orgId, 'api_calls', period), 1)

    // No pending record for API calls — they're too high-volume.
    // API call counts are read from Redis directly.
  }

  /** Track a webhook delivery. */
  async trackWebhookDelivery(orgId: string): Promise<void> {
    const period = periodKey(orgId)
    const redis = getRedis()
    await redis.incrby(usageKey(orgId, 'webhook_deliveries', period), 1)

    this.pendingRecords.push({
      orgId, metric: 'webhook_deliveries', quantity: 1, unitCostCents: 0,
    })
  }

  // ── Concurrent session management ─────────────────────────

  /** Register an active session. Returns false if at the concurrent limit. */
  async registerSession(orgId: string, sessionId: string, maxConcurrent: number): Promise<boolean> {
    const redis = getRedis()
    const key = sessionsKey(orgId)

    const currentSize = await redis.scard(key)
    if (currentSize >= maxConcurrent) {
      return false
    }

    await redis.sadd(key, sessionId)
    return true
  }

  /** Unregister a session when it ends. */
  async unregisterSession(orgId: string, sessionId: string): Promise<void> {
    const redis = getRedis()
    await redis.srem(sessionsKey(orgId), sessionId)
  }

  /** Get the count of currently active sessions. */
  async getActiveSessions(orgId: string): Promise<number> {
    const redis = getRedis()
    return redis.scard(sessionsKey(orgId))
  }

  /** Get all active session IDs. */
  async getActiveSessionIds(orgId: string): Promise<string[]> {
    const redis = getRedis()
    return redis.smembers(sessionsKey(orgId))
  }

  // ── Rate limiting ─────────────────────────────────────────

  /**
   * Check API rate limit using a sliding-window counter.
   * Returns remaining requests allowed in the current window.
   */
  async checkRateLimit(orgId: string, limit: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const redis = getRedis()
    const bucket = minuteBucket()
    const key = rateKey(orgId, bucket)

    const pipeline = redis.pipeline()
    pipeline.incr(key)
    pipeline.expire(key, 120) // TTL 2 minutes to cover window boundary
    const results = await pipeline.exec()

    const current = (results?.[0]?.[1] as number) ?? 1
    const resetAt = (Math.floor(Date.now() / 60_000) + 1) * 60_000

    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      resetAt,
    }
  }

  // ── Quota checking ────────────────────────────────────────

  /** Check if a requested amount of usage is within quota. */
  async checkQuota(orgId: string, plan: string, metric: UsageMetric, requestedAmount: number = 1): Promise<QuotaResult> {
    const limit = getQuotaLimit(plan, metric)
    const used = await this.getMetricUsage(orgId, metric)
    const remaining = Math.max(0, limit - used)

    // Calculate period reset (first of next month UTC)
    const now = new Date()
    const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

    return {
      allowed: limit === Infinity || (used + requestedAmount) <= limit,
      remaining,
      limit,
      used,
      resetAt,
    }
  }

  /** Get current usage for a single metric from Redis. */
  async getMetricUsage(orgId: string, metric: UsageMetric): Promise<number> {
    const redis = getRedis()
    const period = periodKey(orgId)
    const val = await redis.get(usageKey(orgId, metric, period))
    return val ? parseInt(val, 10) : 0
  }

  /** Get remaining quota for a metric. */
  async getRemainingQuota(orgId: string, plan: string, metric: UsageMetric): Promise<number> {
    const limit = getQuotaLimit(plan, metric)
    if (limit === Infinity) return Infinity
    const used = await this.getMetricUsage(orgId, metric)
    return Math.max(0, limit - used)
  }

  /** Get a summary of all usage for the current billing period. */
  async getUsageSummary(orgId: string): Promise<UsageSummary> {
    const period = periodKey(orgId)
    const redis = getRedis()

    const metrics: UsageMetric[] = [
      'session_minutes', 'llm_input_tokens', 'llm_output_tokens',
      'stt_minutes', 'tts_characters', 'api_calls', 'storage_gb', 'webhook_deliveries',
    ]

    const pipeline = redis.pipeline()
    for (const m of metrics) {
      pipeline.get(usageKey(orgId, m, period))
    }
    pipeline.get(costKey(orgId, period))

    const results = await pipeline.exec()
    const usageData: Record<string, number> = {} as Record<string, number>
    for (let i = 0; i < metrics.length; i++) {
      const val = results?.[i]?.[1] as string | null
      usageData[metrics[i]] = val ? parseInt(val, 10) : 0
    }

    const costVal = results?.[metrics.length]?.[1] as string | null
    const estimatedCostCents = costVal ? Math.round(parseFloat(costVal)) : 0

    const now = new Date()
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

    return {
      orgId,
      period,
      metrics: usageData as Record<UsageMetric, number>,
      estimatedCostCents,
      periodStart,
      periodEnd,
    }
  }

  // ── Alert checking ────────────────────────────────────────

  /** Check usage against alert thresholds and fire callbacks. */
  async checkAlerts(orgId: string, plan: string, metric: UsageMetric): Promise<void> {
    if (!this.onAlert) return

    const limit = getQuotaLimit(plan, metric)
    if (limit === Infinity) return

    const used = await this.getMetricUsage(orgId, metric)
    const percent = (used / limit) * 100

    const redis = getRedis()
    for (const threshold of this.alertThresholds) {
      if (percent >= threshold.percent) {
        const key = alertKey(orgId, metric, threshold.percent)
        // Only fire each alert once per billing period (TTL = rest of month)
        const alreadyFired = await redis.get(key)
        if (!alreadyFired) {
          const now = new Date()
          const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
          const ttlSeconds = Math.max(1, Math.floor((endOfMonth.getTime() - now.getTime()) / 1000))
          await redis.setex(key, ttlSeconds, '1')
          this.onAlert(orgId, metric, percent, threshold)
        }
      }
    }
  }

  // ── PostgreSQL flush ──────────────────────────────────────

  /** Flush pending usage records to PostgreSQL. */
  async flush(): Promise<number> {
    if (this.pendingRecords.length === 0) return 0

    const batch = this.pendingRecords.splice(0)
    const dbRecords: NewUsageRecord[] = batch.map((r) => ({
      orgId: r.orgId,
      sessionId: r.sessionId,
      metric: r.metric,
      quantity: r.quantity,
      unitCostCents: r.unitCostCents,
      provider: r.provider,
    }))

    try {
      await this.usageRepo.recordBatch(dbRecords)
    } catch (err) {
      // Put records back on failure so they're retried next flush
      this.pendingRecords.unshift(...batch)
      throw err
    }

    return dbRecords.length
  }

  // ── Stale session cleanup ─────────────────────────────────

  /**
   * Remove sessions that haven't sent a heartbeat in the given threshold.
   * Callers should invoke this periodically (e.g., every 5 minutes).
   * `isAlive` is a callback that checks if a session is still active.
   */
  async cleanStaleSessions(orgId: string, isAlive: (sessionId: string) => Promise<boolean>): Promise<string[]> {
    const sessionIds = await this.getActiveSessionIds(orgId)
    const stale: string[] = []

    for (const sid of sessionIds) {
      const alive = await isAlive(sid)
      if (!alive) {
        await this.unregisterSession(orgId, sid)
        stale.push(sid)
      }
    }

    return stale
  }

  // ── Lifecycle ─────────────────────────────────────────────

  /** Stop the flush timer and flush any remaining records. */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    await this.flush()
  }
}


