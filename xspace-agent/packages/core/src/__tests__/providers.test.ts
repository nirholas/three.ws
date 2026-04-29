// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Provider Intelligence — Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProviderRouter } from '../providers/router'
import { CostTracker } from '../providers/cost-tracker'
import { ProviderHealthMonitor } from '../providers/health-monitor'
import type { RoutableProvider } from '../providers/types'
import type { ProviderMetrics } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMetrics(overrides: Partial<ProviderMetrics> = {}): ProviderMetrics {
  return {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    avgLatencyMs: 100,
    avgTimeToFirstTokenMs: 50,
    ...overrides,
  }
}

function createMockProvider(
  name: string,
  opts: {
    healthy?: boolean
    avgLatencyMs?: number
    costPer1K?: number
  } = {},
): RoutableProvider {
  const healthy = opts.healthy ?? true
  const avgLatencyMs = opts.avgLatencyMs ?? 100
  const costPer1K = opts.costPer1K ?? 1.0

  return {
    name,
    getMetrics: () => createMetrics({ avgLatencyMs }),
    checkHealth: vi.fn().mockResolvedValue({ ok: healthy, latencyMs: 10 }),
    estimateCost: (units: number) => (units / 1000) * costPer1K,
  }
}

// =============================================================================
// ProviderRouter
// =============================================================================

describe('ProviderRouter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('primary-fallback strategy', () => {
    it('selects the primary provider when healthy', () => {
      const providers = [
        createMockProvider('primary'),
        createMockProvider('fallback'),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'primary-fallback',
        primaryIndex: 0,
      })

      const selected = router.select()
      expect(selected.name).toBe('primary')
      router.destroy()
    })

    it('falls back when primary is disabled', () => {
      const providers = [
        createMockProvider('primary'),
        createMockProvider('fallback'),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'primary-fallback',
        primaryIndex: 0,
      })

      router.disable('primary')
      const selected = router.select()
      expect(selected.name).toBe('fallback')
      router.destroy()
    })

    it('re-enables a disabled provider', () => {
      const providers = [
        createMockProvider('primary'),
        createMockProvider('fallback'),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'primary-fallback',
        primaryIndex: 0,
      })

      router.disable('primary')
      expect(router.select().name).toBe('fallback')

      router.enable('primary')
      expect(router.select().name).toBe('primary')
      router.destroy()
    })

    it('returns primary as last resort when all are unhealthy', () => {
      const providers = [
        createMockProvider('primary'),
        createMockProvider('fallback'),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'primary-fallback',
        primaryIndex: 0,
      })

      router.disable('primary')
      router.disable('fallback')
      // Should still return primary as a last resort
      const selected = router.select()
      expect(selected.name).toBe('primary')
      router.destroy()
    })
  })

  describe('latency-based strategy', () => {
    it('selects the provider with lowest latency', () => {
      const providers = [
        createMockProvider('slow', { avgLatencyMs: 500 }),
        createMockProvider('fast', { avgLatencyMs: 50 }),
        createMockProvider('medium', { avgLatencyMs: 200 }),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'latency-based',
      })

      const selected = router.select()
      expect(selected.name).toBe('fast')
      router.destroy()
    })
  })

  describe('cost-based strategy', () => {
    it('selects the cheapest provider', () => {
      const providers = [
        createMockProvider('expensive', { costPer1K: 10.0 }),
        createMockProvider('cheap', { costPer1K: 0.05 }),
        createMockProvider('mid', { costPer1K: 3.0 }),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'cost-based',
      })

      const selected = router.select()
      expect(selected.name).toBe('cheap')
      router.destroy()
    })
  })

  describe('smart strategy', () => {
    it('routes speed hint to lowest latency', () => {
      const providers = [
        createMockProvider('slow', { avgLatencyMs: 500 }),
        createMockProvider('fast', { avgLatencyMs: 50 }),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'smart',
        primaryIndex: 0,
      })

      expect(router.select('speed').name).toBe('fast')
      router.destroy()
    })

    it('routes cost hint to cheapest provider', () => {
      const providers = [
        createMockProvider('expensive', { costPer1K: 10.0 }),
        createMockProvider('cheap', { costPer1K: 0.05 }),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'smart',
        primaryIndex: 0,
      })

      expect(router.select('cost').name).toBe('cheap')
      router.destroy()
    })

    it('routes quality hint to primary', () => {
      const providers = [
        createMockProvider('primary-quality'),
        createMockProvider('secondary'),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'smart',
        primaryIndex: 0,
      })

      expect(router.select('quality').name).toBe('primary-quality')
      router.destroy()
    })
  })

  describe('executeWithFallback', () => {
    it('succeeds with first provider', async () => {
      const providers = [
        createMockProvider('primary'),
        createMockProvider('fallback'),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'primary-fallback',
      })

      const result = await router.executeWithFallback(
        async (p) => `success-${p.name}`,
      )
      expect(result).toBe('success-primary')
      router.destroy()
    })

    it('falls back when first provider fails', async () => {
      const providers = [
        createMockProvider('primary'),
        createMockProvider('fallback'),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'primary-fallback',
      })

      let callCount = 0
      const result = await router.executeWithFallback(async (p) => {
        callCount++
        if (p.name === 'primary') throw new Error('primary down')
        return `success-${p.name}`
      })

      expect(result).toBe('success-fallback')
      expect(callCount).toBe(2)
      router.destroy()
    })

    it('throws when all providers fail', async () => {
      const providers = [
        createMockProvider('a'),
        createMockProvider('b'),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'primary-fallback',
      })

      await expect(
        router.executeWithFallback(async () => {
          throw new Error('fail')
        }),
      ).rejects.toThrow('All providers failed')
      router.destroy()
    })
  })

  describe('getStatus', () => {
    it('returns status for all providers', () => {
      const providers = [
        createMockProvider('a'),
        createMockProvider('b'),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'primary-fallback',
      })

      const status = router.getStatus()
      expect(status).toHaveLength(2)
      expect(status[0].name).toBe('a')
      expect(status[0].healthy).toBe(true)
      expect(status[0].enabled).toBe(true)
      expect(status[1].name).toBe('b')
      router.destroy()
    })
  })

  describe('admin controls', () => {
    it('disable/enable returns false for unknown provider', () => {
      const router = new ProviderRouter({
        providers: [createMockProvider('a')],
        strategy: 'primary-fallback',
      })

      expect(router.disable('nonexistent')).toBe(false)
      expect(router.enable('nonexistent')).toBe(false)
      router.destroy()
    })

    it('setStrategy changes routing behavior', () => {
      const providers = [
        createMockProvider('slow-cheap', { avgLatencyMs: 500, costPer1K: 0.05 }),
        createMockProvider('fast-expensive', { avgLatencyMs: 50, costPer1K: 10.0 }),
      ]
      const router = new ProviderRouter({
        providers,
        strategy: 'latency-based',
      })

      expect(router.select().name).toBe('fast-expensive')

      router.setStrategy('cost-based')
      expect(router.select().name).toBe('slow-cheap')
      router.destroy()
    })
  })
})

// =============================================================================
// CostTracker
// =============================================================================

describe('CostTracker', () => {
  let tracker: CostTracker

  beforeEach(() => {
    tracker = new CostTracker()
  })

  describe('trackLLM', () => {
    it('tracks LLM costs correctly', () => {
      tracker.trackLLM('openai-gpt-4o', 1_000_000, 500_000)
      const summary = tracker.getSummary()

      // 1M input * $2.50/1M + 500K output * $10/1M = $2.50 + $5.00 = $7.50
      expect(summary.total).toBeCloseTo(7.5)
      expect(summary.byProvider['openai-gpt-4o']).toBeCloseTo(7.5)
      expect(summary.byType['llm']).toBeCloseTo(7.5)
      expect(summary.requestCount).toBe(1)
    })

    it('returns 0 for unknown provider', () => {
      const cost = tracker.trackLLM('unknown-provider', 1000, 500)
      expect(cost).toBe(0)
    })
  })

  describe('trackSTT', () => {
    it('tracks STT costs correctly', () => {
      tracker.trackSTT('openai-whisper', 60) // 1 minute
      const summary = tracker.getSummary()

      // 1 minute * $0.006/min = $0.006
      expect(summary.total).toBeCloseTo(0.006)
      expect(summary.byType['stt']).toBeCloseTo(0.006)
    })

    it('groq-whisper is free', () => {
      tracker.trackSTT('groq-whisper', 3600)
      const summary = tracker.getSummary()
      expect(summary.total).toBe(0)
    })
  })

  describe('trackTTS', () => {
    it('tracks TTS costs correctly', () => {
      tracker.trackTTS('openai-tts', 1000) // 1000 chars
      const summary = tracker.getSummary()

      // 1000 * $0.000015 = $0.015
      expect(summary.total).toBeCloseTo(0.015)
      expect(summary.byType['tts']).toBeCloseTo(0.015)
    })

    it('elevenlabs is roughly 2x openai', () => {
      const openaiCost = CostTracker.estimateTTSCost('openai-tts', 1000)
      const elevenCost = CostTracker.estimateTTSCost('elevenlabs-tts', 1000)

      expect(elevenCost).toBeCloseTo(openaiCost * 2)
    })
  })

  describe('getSummary', () => {
    it('filters by time window', () => {
      tracker.trackLLM('openai-gpt-4o', 100_000, 50_000)

      // Get summary for last second — should include our recent entry
      const recent = tracker.getSummary(1000)
      expect(recent.requestCount).toBe(1)

      // No filter — returns all
      const all = tracker.getSummary()
      expect(all.requestCount).toBe(1)
    })

    it('aggregates multiple providers', () => {
      tracker.trackLLM('openai-gpt-4o', 100_000, 50_000)
      tracker.trackLLM('groq-llama', 100_000, 50_000)
      tracker.trackSTT('openai-whisper', 30)
      tracker.trackTTS('openai-tts', 500)

      const summary = tracker.getSummary()
      expect(summary.requestCount).toBe(4)
      expect(Object.keys(summary.byProvider).length).toBe(4)
      expect(Object.keys(summary.byType).length).toBe(3)
    })
  })

  describe('static estimators', () => {
    it('estimateLLMCost returns correct values', () => {
      const cost = CostTracker.estimateLLMCost('claude-sonnet', 1_000_000, 1_000_000)
      // $3.00 input + $15.00 output = $18.00
      expect(cost).toBeCloseTo(18.0)
    })

    it('estimateSTTCost returns correct values', () => {
      const cost = CostTracker.estimateSTTCost('openai-whisper', 120)
      // 2 min * $0.006 = $0.012
      expect(cost).toBeCloseTo(0.012)
    })
  })

  describe('clear', () => {
    it('resets all entries', () => {
      tracker.trackLLM('openai-gpt-4o', 100_000, 50_000)
      expect(tracker.getSummary().requestCount).toBe(1)

      tracker.clear()
      expect(tracker.getSummary().requestCount).toBe(0)
      expect(tracker.getSummary().total).toBe(0)
    })
  })
})

// =============================================================================
// ProviderHealthMonitor
// =============================================================================

describe('ProviderHealthMonitor', () => {
  let monitor: ProviderHealthMonitor

  // Flush microtask queue to let async healthCheck results propagate
  const flush = () => new Promise<void>((r) => setTimeout(r, 0))

  beforeEach(() => {
    monitor = new ProviderHealthMonitor()
  })

  afterEach(() => {
    monitor.stopAll()
  })

  it('runs an initial health check on startMonitoring', async () => {
    const provider = createMockProvider('test', { healthy: true })
    monitor.startMonitoring([provider], 600_000) // Long interval so only initial fires
    await flush()

    expect(provider.checkHealth).toHaveBeenCalled()
    const result = monitor.getLastResult('test')
    expect(result).toBeDefined()
    expect(result!.healthy).toBe(true)
  })

  it('fires onHealthChange when state changes', async () => {
    const provider = createMockProvider('test', { healthy: true })
    const handler = vi.fn()
    monitor.onHealthChange(handler)

    // Use a very short interval for testing
    monitor.startMonitoring([provider], 50)
    await flush()

    // Initial check: undefined → healthy → fires event
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'test', healthy: true }),
    )

    // Now make it unhealthy and wait for next interval
    ;(provider.checkHealth as any).mockResolvedValue({ ok: false, latencyMs: 0, error: 'down' })
    await new Promise<void>((r) => setTimeout(r, 100))

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'test', healthy: false }),
    )
  })

  it('does not fire for same-state transitions', async () => {
    const provider = createMockProvider('test', { healthy: true })
    const handler = vi.fn()
    monitor.onHealthChange(handler)

    monitor.startMonitoring([provider], 50)
    await flush()

    // First call fires (undefined → true)
    expect(handler).toHaveBeenCalledTimes(1)

    // Wait for another interval — same state, should NOT fire again
    await new Promise<void>((r) => setTimeout(r, 100))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('stopMonitoring stops checks for a specific provider', async () => {
    const provider = createMockProvider('test', { healthy: true })
    monitor.startMonitoring([provider], 50)
    await flush()

    const callsBefore = (provider.checkHealth as any).mock.calls.length
    monitor.stopMonitoring('test')

    await new Promise<void>((r) => setTimeout(r, 150))
    expect((provider.checkHealth as any).mock.calls.length).toBe(callsBefore)
  })

  it('getAllResults returns all known results', async () => {
    const providers = [
      createMockProvider('a', { healthy: true }),
      createMockProvider('b', { healthy: false }),
    ]
    monitor.startMonitoring(providers, 600_000)
    await flush()

    const results = monitor.getAllResults()
    expect(results).toHaveLength(2)
    expect(results.find((r) => r.name === 'a')?.healthy).toBe(true)
    expect(results.find((r) => r.name === 'b')?.healthy).toBe(false)
  })

  it('handles checkHealth throwing', async () => {
    const provider = {
      name: 'flaky',
      getMetrics: () => createMetrics(),
      checkHealth: vi.fn().mockRejectedValue(new Error('network error')),
      estimateCost: () => 0,
    }
    monitor.startMonitoring([provider], 600_000)
    await flush()

    const result = monitor.getLastResult('flaky')
    expect(result).toBeDefined()
    expect(result!.healthy).toBe(false)
  })
})


