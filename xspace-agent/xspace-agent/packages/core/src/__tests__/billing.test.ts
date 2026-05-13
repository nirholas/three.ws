// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Billing — Usage Tracker & Quota Enforcement Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UsageTracker, getQuotaLimit } from '../billing/usage-tracker'
import { CostTracker } from '../providers/cost-tracker'
import {
  RATE_LIMITS_BY_PLAN,
  ENDPOINT_GROUP_LIMITS,
  DEFAULT_ALERT_THRESHOLDS,
} from '../billing/types'
import type { UsageMetric } from '../billing/types'

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const mockRedisData: Record<string, string> = {}
const mockRedisSets: Record<string, Set<string>> = {}

const mockPipeline = {
  incrby: vi.fn().mockReturnThis(),
  incr: vi.fn().mockReturnThis(),
  incrbyfloat: vi.fn().mockReturnThis(),
  get: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: vi.fn().mockResolvedValue([]),
}

const mockRedis = {
  incrby: vi.fn(async (key: string, val: number) => {
    const cur = parseInt(mockRedisData[key] ?? '0', 10)
    mockRedisData[key] = String(cur + val)
    return cur + val
  }),
  incr: vi.fn(async (key: string) => {
    const cur = parseInt(mockRedisData[key] ?? '0', 10)
    mockRedisData[key] = String(cur + 1)
    return cur + 1
  }),
  get: vi.fn(async (key: string) => mockRedisData[key] ?? null),
  set: vi.fn(async (key: string, val: string) => { mockRedisData[key] = val }),
  setex: vi.fn(async (key: string, _ttl: number, val: string) => { mockRedisData[key] = val }),
  scard: vi.fn(async (key: string) => mockRedisSets[key]?.size ?? 0),
  sadd: vi.fn(async (key: string, val: string) => {
    if (!mockRedisSets[key]) mockRedisSets[key] = new Set()
    mockRedisSets[key].add(val)
  }),
  srem: vi.fn(async (key: string, val: string) => {
    mockRedisSets[key]?.delete(val)
  }),
  smembers: vi.fn(async (key: string) => [...(mockRedisSets[key] ?? [])]),
  pipeline: vi.fn(() => mockPipeline),
  expire: vi.fn(),
}

vi.mock('../db/redis', () => ({
  getRedis: () => mockRedis,
}))

// Mock UsageRepository
const mockRecordBatch = vi.fn()
vi.mock('../db/repositories/usage', () => {
  return {
    UsageRepository: class {
      recordBatch = mockRecordBatch
      record = vi.fn()
      findByOrgId = vi.fn().mockResolvedValue([])
      aggregateByOrg = vi.fn().mockResolvedValue([])
    },
  }
})

// =============================================================================
// getQuotaLimit
// =============================================================================

describe('getQuotaLimit', () => {
  it('returns correct limits for free plan', () => {
    expect(getQuotaLimit('free', 'session_minutes')).toBe(60)
    expect(getQuotaLimit('free', 'llm_input_tokens')).toBe(1_000_000)
    expect(getQuotaLimit('free', 'webhook_deliveries')).toBe(0)
  })

  it('returns correct limits for developer plan', () => {
    expect(getQuotaLimit('developer', 'session_minutes')).toBe(1_000)
    expect(getQuotaLimit('developer', 'tts_characters')).toBe(500_000)
  })

  it('returns Infinity for enterprise plan', () => {
    expect(getQuotaLimit('enterprise', 'session_minutes')).toBe(Infinity)
    expect(getQuotaLimit('enterprise', 'api_calls')).toBe(Infinity)
  })

  it('returns 0 for unknown plan', () => {
    expect(getQuotaLimit('nonexistent', 'session_minutes')).toBe(0)
  })
})

// =============================================================================
// UsageTracker
// =============================================================================

describe('UsageTracker', () => {
  let tracker: UsageTracker

  beforeEach(() => {
    // Clear mock data
    Object.keys(mockRedisData).forEach((k) => delete mockRedisData[k])
    Object.keys(mockRedisSets).forEach((k) => delete mockRedisSets[k])
    vi.clearAllMocks()

    tracker = new UsageTracker({ flushIntervalMs: 60_000 })
  })

  afterEach(async () => {
    await tracker.shutdown()
  })

  // ── Session tracking ─────────────────────────────────────

  describe('trackSessionMinute', () => {
    it('increments session_minutes counter in Redis', async () => {
      await tracker.trackSessionMinute('org-1', 'session-1')

      expect(mockRedis.incrby).toHaveBeenCalledWith(
        expect.stringContaining('usage:org-1:session_minutes:'),
        1,
      )
    })

    it('accumulates pending records for flush', async () => {
      await tracker.trackSessionMinute('org-1', 'session-1')
      await tracker.trackSessionMinute('org-1', 'session-1')

      const flushed = await tracker.flush()
      expect(flushed).toBe(2)
      expect(mockRecordBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ metric: 'session_minutes', quantity: 1 }),
        ]),
      )
    })
  })

  // ── LLM tracking ─────────────────────────────────────────

  describe('trackLLMUsage', () => {
    it('increments both input and output token counters', async () => {
      mockPipeline.exec.mockResolvedValueOnce([])
      await tracker.trackLLMUsage('org-1', 'session-1', 'openai-gpt-4o', 1000, 500)

      expect(mockPipeline.incrby).toHaveBeenCalledTimes(2)
      expect(mockPipeline.incrbyfloat).toHaveBeenCalledTimes(1)
    })

    it('creates pending records for both token types', async () => {
      mockPipeline.exec.mockResolvedValueOnce([])
      await tracker.trackLLMUsage('org-1', 'session-1', 'openai-gpt-4o', 1000, 500)

      const flushed = await tracker.flush()
      expect(flushed).toBe(2) // One for input, one for output
    })
  })

  // ── STT tracking ──────────────────────────────────────────

  describe('trackSTTUsage', () => {
    it('tracks duration in minutes', async () => {
      mockPipeline.exec.mockResolvedValueOnce([])
      await tracker.trackSTTUsage('org-1', 'session-1', 'openai-whisper', 90_000)

      expect(mockPipeline.incrby).toHaveBeenCalledWith(
        expect.stringContaining('stt_minutes'),
        2, // 90s = 2 minutes (ceiling)
      )
    })
  })

  // ── TTS tracking ──────────────────────────────────────────

  describe('trackTTSUsage', () => {
    it('tracks character count', async () => {
      mockPipeline.exec.mockResolvedValueOnce([])
      await tracker.trackTTSUsage('org-1', 'session-1', 'elevenlabs-tts', 500)

      expect(mockPipeline.incrby).toHaveBeenCalledWith(
        expect.stringContaining('tts_characters'),
        500,
      )
    })
  })

  // ── API call tracking ─────────────────────────────────────

  describe('trackAPICall', () => {
    it('increments api_calls counter', async () => {
      await tracker.trackAPICall('org-1', '/agents/start')

      expect(mockRedis.incrby).toHaveBeenCalledWith(
        expect.stringContaining('usage:org-1:api_calls:'),
        1,
      )
    })
  })

  // ── Concurrent session management ─────────────────────────

  describe('session management', () => {
    it('registers a session when under limit', async () => {
      const result = await tracker.registerSession('org-1', 'session-1', 3)
      expect(result).toBe(true)
      expect(mockRedis.sadd).toHaveBeenCalledWith(
        expect.stringContaining('rate:org-1:sessions'),
        'session-1',
      )
    })

    it('rejects registration when at limit', async () => {
      mockRedis.scard.mockResolvedValueOnce(3)
      const result = await tracker.registerSession('org-1', 'session-4', 3)
      expect(result).toBe(false)
    })

    it('unregisters a session', async () => {
      await tracker.unregisterSession('org-1', 'session-1')
      expect(mockRedis.srem).toHaveBeenCalledWith(
        expect.stringContaining('rate:org-1:sessions'),
        'session-1',
      )
    })

    it('returns active session count', async () => {
      mockRedis.scard.mockResolvedValueOnce(5)
      const count = await tracker.getActiveSessions('org-1')
      expect(count).toBe(5)
    })
  })

  // ── Rate limiting ─────────────────────────────────────────

  describe('checkRateLimit', () => {
    it('allows requests under the limit', async () => {
      mockPipeline.exec.mockResolvedValueOnce([
        [null, 1], // incr result
        [null, 1], // expire result
      ])

      const result = await tracker.checkRateLimit('org-1', 100)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(99)
    })

    it('rejects requests over the limit', async () => {
      mockPipeline.exec.mockResolvedValueOnce([
        [null, 101], // incr result = 101
        [null, 1],
      ])

      const result = await tracker.checkRateLimit('org-1', 100)
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('returns a resetAt timestamp at the next minute boundary', async () => {
      mockPipeline.exec.mockResolvedValueOnce([
        [null, 1],
        [null, 1],
      ])

      const result = await tracker.checkRateLimit('org-1', 100)
      expect(result.resetAt).toBeGreaterThan(Date.now())
      expect(result.resetAt).toBeLessThanOrEqual(Date.now() + 60_000)
    })
  })

  // ── Quota checking ────────────────────────────────────────

  describe('checkQuota', () => {
    it('allows usage within quota', async () => {
      mockRedis.get.mockResolvedValueOnce('30') // 30 minutes used

      const result = await tracker.checkQuota('org-1', 'free', 'session_minutes', 1)
      expect(result.allowed).toBe(true)
      expect(result.used).toBe(30)
      expect(result.limit).toBe(60)
      expect(result.remaining).toBe(30)
    })

    it('denies usage over quota', async () => {
      mockRedis.get.mockResolvedValueOnce('60') // 60 minutes used = at limit

      const result = await tracker.checkQuota('org-1', 'free', 'session_minutes', 1)
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('always allows enterprise plan', async () => {
      mockRedis.get.mockResolvedValueOnce('999999')

      const result = await tracker.checkQuota('org-1', 'enterprise', 'session_minutes', 1)
      expect(result.allowed).toBe(true)
    })

    it('returns resetAt as first of next month', async () => {
      mockRedis.get.mockResolvedValueOnce('0')

      const result = await tracker.checkQuota('org-1', 'free', 'session_minutes')
      const nextMonth = new Date()
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
      nextMonth.setUTCDate(1)
      expect(result.resetAt.getUTCMonth()).toBe(nextMonth.getUTCMonth())
    })
  })

  // ── Usage summary ─────────────────────────────────────────

  describe('getUsageSummary', () => {
    it('returns aggregated metrics from Redis', async () => {
      // Mock pipeline.exec to return values for all metrics + cost
      const metricCount = 8
      const mockResults = Array(metricCount).fill(null).map((_, i) => [null, String(i * 100)])
      mockResults.push([null, '4500']) // cost key
      mockPipeline.exec.mockResolvedValueOnce(mockResults)

      const summary = await tracker.getUsageSummary('org-1')
      expect(summary.orgId).toBe('org-1')
      expect(summary.estimatedCostCents).toBe(4500)
      expect(summary.periodStart).toBeInstanceOf(Date)
      expect(summary.periodEnd).toBeInstanceOf(Date)
      expect(summary.periodEnd > summary.periodStart).toBe(true)
    })
  })

  // ── Flush to PostgreSQL ───────────────────────────────────

  describe('flush', () => {
    it('returns 0 when no pending records', async () => {
      const count = await tracker.flush()
      expect(count).toBe(0)
      expect(mockRecordBatch).not.toHaveBeenCalled()
    })

    it('flushes pending records to PostgreSQL', async () => {
      await tracker.trackSessionMinute('org-1', 'session-1')

      const count = await tracker.flush()
      expect(count).toBe(1)
      expect(mockRecordBatch).toHaveBeenCalledWith([
        expect.objectContaining({
          orgId: 'org-1',
          sessionId: 'session-1',
          metric: 'session_minutes',
          quantity: 1,
        }),
      ])
    })

    it('restores records on flush failure', async () => {
      await tracker.trackSessionMinute('org-1', 'session-1')
      mockRecordBatch.mockRejectedValueOnce(new Error('DB connection lost'))

      await expect(tracker.flush()).rejects.toThrow('DB connection lost')

      // Records should be put back
      mockRecordBatch.mockResolvedValueOnce(undefined)
      const count = await tracker.flush()
      expect(count).toBe(1)
    })
  })

  // ── Stale session cleanup ─────────────────────────────────

  describe('cleanStaleSessions', () => {
    it('removes sessions that fail alive check', async () => {
      mockRedisSets['xspace:rate:org-1:sessions'] = new Set(['s1', 's2', 's3'])
      mockRedis.smembers.mockResolvedValueOnce(['s1', 's2', 's3'])

      const isAlive = vi.fn()
        .mockResolvedValueOnce(true)   // s1 alive
        .mockResolvedValueOnce(false)  // s2 dead
        .mockResolvedValueOnce(false)  // s3 dead

      const stale = await tracker.cleanStaleSessions('org-1', isAlive)
      expect(stale).toEqual(['s2', 's3'])
      expect(mockRedis.srem).toHaveBeenCalledTimes(2)
    })
  })

  // ── Alerts ────────────────────────────────────────────────

  describe('checkAlerts', () => {
    it('fires alert callback when threshold is crossed', async () => {
      const onAlert = vi.fn()
      const alertTracker = new UsageTracker({ flushIntervalMs: 60_000, onAlert })

      // Simulate 80% usage of free plan session_minutes (60 * 0.8 = 48)
      mockRedis.get
        .mockResolvedValueOnce('48')   // getMetricUsage
        .mockResolvedValueOnce(null)   // alertKey for 50%
        .mockResolvedValueOnce(null)   // alertKey for 75%

      await alertTracker.checkAlerts('org-1', 'free', 'session_minutes')

      expect(onAlert).toHaveBeenCalledTimes(2) // 50% and 75% thresholds
      expect(onAlert).toHaveBeenCalledWith(
        'org-1',
        'session_minutes',
        80,
        expect.objectContaining({ percent: 50 }),
      )

      await alertTracker.shutdown()
    })

    it('does not fire alerts for enterprise plan', async () => {
      const onAlert = vi.fn()
      const alertTracker = new UsageTracker({ flushIntervalMs: 60_000, onAlert })

      await alertTracker.checkAlerts('org-1', 'enterprise', 'session_minutes')

      expect(onAlert).not.toHaveBeenCalled()
      await alertTracker.shutdown()
    })
  })
})

// =============================================================================
// CostTracker + UsageTracker Integration
// =============================================================================

describe('CostTracker integration with UsageTracker', () => {
  let costTracker: CostTracker
  let usageTracker: UsageTracker

  beforeEach(() => {
    Object.keys(mockRedisData).forEach((k) => delete mockRedisData[k])
    vi.clearAllMocks()
    mockPipeline.exec.mockResolvedValue([])

    costTracker = new CostTracker()
    usageTracker = new UsageTracker({ flushIntervalMs: 60_000 })
  })

  afterEach(async () => {
    await usageTracker.shutdown()
  })

  it('forwards LLM tracking to usage tracker when bound', () => {
    const spy = vi.spyOn(usageTracker, 'trackLLMUsage').mockResolvedValue()
    costTracker.bindUsageTracker(usageTracker, 'org-1', 'session-1')

    costTracker.trackLLM('openai-gpt-4o', 1000, 500)

    expect(spy).toHaveBeenCalledWith('org-1', 'session-1', 'openai-gpt-4o', 1000, 500)
  })

  it('forwards STT tracking to usage tracker when bound', () => {
    const spy = vi.spyOn(usageTracker, 'trackSTTUsage').mockResolvedValue()
    costTracker.bindUsageTracker(usageTracker, 'org-1', 'session-1')

    costTracker.trackSTT('openai-whisper', 30)

    // STT forwards durationSeconds * 1000 as durationMs
    expect(spy).toHaveBeenCalledWith('org-1', 'session-1', 'openai-whisper', 30_000)
  })

  it('forwards TTS tracking to usage tracker when bound', () => {
    const spy = vi.spyOn(usageTracker, 'trackTTSUsage').mockResolvedValue()
    costTracker.bindUsageTracker(usageTracker, 'org-1', 'session-1')

    costTracker.trackTTS('elevenlabs-tts', 200)

    expect(spy).toHaveBeenCalledWith('org-1', 'session-1', 'elevenlabs-tts', 200)
  })

  it('does not forward when usage tracker is not bound', () => {
    // No binding — should not throw
    const cost = costTracker.trackLLM('openai-gpt-4o', 1000, 500)
    expect(cost).toBeGreaterThan(0)
  })
})

// =============================================================================
// Types & Constants
// =============================================================================

describe('billing constants', () => {
  it('RATE_LIMITS_BY_PLAN has all tiers', () => {
    expect(RATE_LIMITS_BY_PLAN.free).toBe(10)
    expect(RATE_LIMITS_BY_PLAN.developer).toBe(100)
    expect(RATE_LIMITS_BY_PLAN.pro).toBe(500)
    expect(RATE_LIMITS_BY_PLAN.business).toBe(2000)
    expect(RATE_LIMITS_BY_PLAN.enterprise).toBe(10000)
  })

  it('ENDPOINT_GROUP_LIMITS has correct values', () => {
    expect(ENDPOINT_GROUP_LIMITS.agents).toBe(0.5)
    expect(ENDPOINT_GROUP_LIMITS.conversations).toBe(0.3)
    expect(ENDPOINT_GROUP_LIMITS.billing).toBe(10)
  })

  it('DEFAULT_ALERT_THRESHOLDS has 4 levels', () => {
    expect(DEFAULT_ALERT_THRESHOLDS).toHaveLength(4)
    expect(DEFAULT_ALERT_THRESHOLDS[0].percent).toBe(50)
    expect(DEFAULT_ALERT_THRESHOLDS[3].percent).toBe(100)
  })
})


