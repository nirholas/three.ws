// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProviderHealthMonitor } from '../../../src/providers/health-monitor'
import type { RoutableProvider, HealthCheckResult } from '../../../src/providers/types'

function createMockProvider(
  name: string,
  healthResult: HealthCheckResult = { ok: true, latencyMs: 50 },
): RoutableProvider {
  return {
    name,
    checkHealth: vi.fn().mockResolvedValue(healthResult),
    getMetrics: vi.fn().mockReturnValue({
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      avgLatencyMs: 0,
    }),
    estimateCost: vi.fn().mockReturnValue(0),
  }
}

describe('ProviderHealthMonitor', () => {
  let monitor: ProviderHealthMonitor

  beforeEach(() => {
    vi.useFakeTimers()
    monitor = new ProviderHealthMonitor()
  })

  afterEach(() => {
    monitor.stopAll()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Basic monitoring
  // ---------------------------------------------------------------------------

  it('should start monitoring providers', async () => {
    const provider = createMockProvider('openai')
    monitor.startMonitoring([provider], 1000)

    // Immediate check on start
    await vi.advanceTimersByTimeAsync(10)
    expect(provider.checkHealth).toHaveBeenCalled()
  })

  it('should run periodic checks at the configured interval', async () => {
    const provider = createMockProvider('openai')
    monitor.startMonitoring([provider], 1000)

    // Immediate check + 1 interval
    await vi.advanceTimersByTimeAsync(1100)
    expect(provider.checkHealth).toHaveBeenCalledTimes(2) // immediate + 1 interval
  })

  it('should monitor multiple providers', async () => {
    const p1 = createMockProvider('openai')
    const p2 = createMockProvider('claude')
    monitor.startMonitoring([p1, p2], 1000)

    await vi.advanceTimersByTimeAsync(10)
    expect(p1.checkHealth).toHaveBeenCalled()
    expect(p2.checkHealth).toHaveBeenCalled()
  })

  it('should not duplicate monitoring for the same provider', async () => {
    const provider = createMockProvider('openai')
    monitor.startMonitoring([provider], 1000)
    monitor.startMonitoring([provider], 1000)

    await vi.advanceTimersByTimeAsync(1100)
    // Only 2 calls (immediate + 1 interval), not doubled
    expect(provider.checkHealth).toHaveBeenCalledTimes(2)
  })

  // ---------------------------------------------------------------------------
  // Stop monitoring
  // ---------------------------------------------------------------------------

  it('should stop monitoring a specific provider', async () => {
    const provider = createMockProvider('openai')
    monitor.startMonitoring([provider], 1000)

    await vi.advanceTimersByTimeAsync(10)
    const initialCalls = (provider.checkHealth as any).mock.calls.length

    monitor.stopMonitoring('openai')
    await vi.advanceTimersByTimeAsync(3000)

    expect(provider.checkHealth).toHaveBeenCalledTimes(initialCalls)
  })

  it('should stop all monitoring', async () => {
    const p1 = createMockProvider('openai')
    const p2 = createMockProvider('claude')
    monitor.startMonitoring([p1, p2], 1000)

    await vi.advanceTimersByTimeAsync(10)
    monitor.stopAll()

    const p1Calls = (p1.checkHealth as any).mock.calls.length
    const p2Calls = (p2.checkHealth as any).mock.calls.length

    await vi.advanceTimersByTimeAsync(5000)

    expect(p1.checkHealth).toHaveBeenCalledTimes(p1Calls)
    expect(p2.checkHealth).toHaveBeenCalledTimes(p2Calls)
  })

  it('should handle stopMonitoring for non-existent provider gracefully', () => {
    // Should not throw
    monitor.stopMonitoring('nonexistent')
  })

  // ---------------------------------------------------------------------------
  // Health results
  // ---------------------------------------------------------------------------

  it('should store and return last health result', async () => {
    const provider = createMockProvider('openai', { ok: true, latencyMs: 42 })
    monitor.startMonitoring([provider], 1000)
    await vi.advanceTimersByTimeAsync(10)

    const result = monitor.getLastResult('openai')
    expect(result).toBeDefined()
    expect(result!.name).toBe('openai')
    expect(result!.healthy).toBe(true)
    expect(result!.latencyMs).toBe(42)
    expect(result!.timestamp).toBeGreaterThan(0)
  })

  it('should return undefined for unchecked provider', () => {
    expect(monitor.getLastResult('nonexistent')).toBeUndefined()
  })

  it('should return all results', async () => {
    const p1 = createMockProvider('openai', { ok: true, latencyMs: 10 })
    const p2 = createMockProvider('claude', { ok: false, latencyMs: 0, error: 'timeout' })
    monitor.startMonitoring([p1, p2], 1000)
    await vi.advanceTimersByTimeAsync(10)

    const results = monitor.getAllResults()
    expect(results).toHaveLength(2)
    expect(results.find((r) => r.name === 'openai')?.healthy).toBe(true)
    expect(results.find((r) => r.name === 'claude')?.healthy).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Health change events
  // ---------------------------------------------------------------------------

  it('should notify listeners on first health check (state change from none)', async () => {
    const listener = vi.fn()
    monitor.onHealthChange(listener)

    const provider = createMockProvider('openai', { ok: true, latencyMs: 30 })
    monitor.startMonitoring([provider], 1000)
    await vi.advanceTimersByTimeAsync(10)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'openai',
        healthy: true,
        latencyMs: 30,
      }),
    )
  })

  it('should notify when health state changes from healthy to unhealthy', async () => {
    const listener = vi.fn()
    monitor.onHealthChange(listener)

    const provider = createMockProvider('openai', { ok: true, latencyMs: 30 })
    monitor.startMonitoring([provider], 1000)
    await vi.advanceTimersByTimeAsync(10) // Initial check: healthy
    expect(listener).toHaveBeenCalledTimes(1)

    // Change provider to unhealthy
    ;(provider.checkHealth as any).mockResolvedValue({ ok: false, latencyMs: 0, error: 'timeout' })
    await vi.advanceTimersByTimeAsync(1100) // Next interval
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[1][0].healthy).toBe(false)
    expect(listener.mock.calls[1][0].error).toBe('timeout')
  })

  it('should NOT notify when health state stays the same', async () => {
    const listener = vi.fn()
    monitor.onHealthChange(listener)

    const provider = createMockProvider('openai', { ok: true, latencyMs: 30 })
    monitor.startMonitoring([provider], 1000)
    await vi.advanceTimersByTimeAsync(10) // Initial: healthy
    expect(listener).toHaveBeenCalledTimes(1)

    // Same health state on next check
    await vi.advanceTimersByTimeAsync(1100)
    expect(listener).toHaveBeenCalledTimes(1) // Still just 1
  })

  it('should notify when health state recovers from unhealthy to healthy', async () => {
    const listener = vi.fn()
    monitor.onHealthChange(listener)

    const provider = createMockProvider('openai', { ok: false, latencyMs: 0, error: 'down' })
    monitor.startMonitoring([provider], 1000)
    await vi.advanceTimersByTimeAsync(10)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].healthy).toBe(false)

    // Recover
    ;(provider.checkHealth as any).mockResolvedValue({ ok: true, latencyMs: 25 })
    await vi.advanceTimersByTimeAsync(1100)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[1][0].healthy).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Error handling in checkHealth
  // ---------------------------------------------------------------------------

  it('should handle checkHealth throwing an exception', async () => {
    const listener = vi.fn()
    monitor.onHealthChange(listener)

    const provider = createMockProvider('openai')
    ;(provider.checkHealth as any).mockRejectedValue(new Error('Network error'))

    monitor.startMonitoring([provider], 1000)
    await vi.advanceTimersByTimeAsync(10)

    // Should still record a result with ok: false
    const result = monitor.getLastResult('openai')
    expect(result).toBeDefined()
    expect(result!.healthy).toBe(false)
    expect(result!.error).toBe('Network error')
  })

  // ---------------------------------------------------------------------------
  // Listener error handling
  // ---------------------------------------------------------------------------

  it('should not propagate errors from listener callbacks', async () => {
    monitor.onHealthChange(() => {
      throw new Error('listener crash')
    })

    const provider = createMockProvider('openai')
    monitor.startMonitoring([provider], 1000)

    // Should not throw
    await vi.advanceTimersByTimeAsync(10)
  })

  // ---------------------------------------------------------------------------
  // Multiple listeners
  // ---------------------------------------------------------------------------

  it('should support multiple listeners', async () => {
    const listener1 = vi.fn()
    const listener2 = vi.fn()
    monitor.onHealthChange(listener1)
    monitor.onHealthChange(listener2)

    const provider = createMockProvider('openai')
    monitor.startMonitoring([provider], 1000)
    await vi.advanceTimersByTimeAsync(10)

    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledTimes(1)
  })
})


