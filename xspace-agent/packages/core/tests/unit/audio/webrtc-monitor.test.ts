// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebRTCMonitor } from '../../../src/audio/webrtc-monitor'

// Mock the logger module
vi.mock('../../../src/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('WebRTCMonitor', () => {
  let monitor: WebRTCMonitor

  beforeEach(() => {
    vi.useFakeTimers()
    monitor = new WebRTCMonitor()
  })

  afterEach(async () => {
    await monitor.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  it('should use default config values', () => {
    const m = new WebRTCMonitor()
    const stats = m.getStats()
    expect(stats).toEqual({
      packetsLost: 0,
      jitter: 0,
      roundTripTime: 0,
      bytesReceived: 0,
    })
  })

  it('should accept custom config', () => {
    const m = new WebRTCMonitor({
      pollIntervalMs: 10000,
      packetLossThreshold: 100,
      jitterThreshold: 0.1,
    })
    expect(m.getStats().packetsLost).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // getStats
  // ---------------------------------------------------------------------------

  it('should return a copy of lastStats', () => {
    const stats1 = monitor.getStats()
    const stats2 = monitor.getStats()
    expect(stats1).toEqual(stats2)
    expect(stats1).not.toBe(stats2) // Different object references
  })

  // ---------------------------------------------------------------------------
  // Callbacks
  // ---------------------------------------------------------------------------

  it('should register onStats callback', () => {
    const callback = vi.fn()
    monitor.onStats(callback)
    // Callback is stored — no error
  })

  it('should register onDegraded callback', () => {
    const callback = vi.fn()
    monitor.onDegraded(callback)
    // Callback is stored — no error
  })

  // ---------------------------------------------------------------------------
  // Start / Stop lifecycle
  // ---------------------------------------------------------------------------

  it('should start with a mock page that supports evaluate', async () => {
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue(undefined),
    } as any

    await monitor.start(mockPage)

    // evaluateOnNewDocument should have been called to inject poller
    expect(mockPage.evaluate).toHaveBeenCalled()
  })

  it('should stop cleanly and clear intervals', async () => {
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue(undefined),
    } as any

    await monitor.start(mockPage)
    await monitor.stop()

    // Page evaluate should have been called to clear browser-side interval
    expect(mockPage.evaluate).toHaveBeenCalledTimes(2) // start + stop
  })

  it('should handle stop when page is already closed', async () => {
    const mockPage = {
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined) // start
        .mockRejectedValueOnce(new Error('page closed')), // stop
    } as any

    await monitor.start(mockPage)
    // Should not throw
    await monitor.stop()
  })

  it('should stop cleanly when not started', async () => {
    // Should not throw
    await monitor.stop()
  })

  // ---------------------------------------------------------------------------
  // readStats (private, tested via timer advancement)
  // ---------------------------------------------------------------------------

  it('should read stats from page on poll interval', async () => {
    const mockStats = {
      packetsLost: 5,
      jitter: 0.01,
      roundTripTime: 0.05,
      bytesReceived: 10000,
    }

    const statsCallback = vi.fn()
    monitor.onStats(statsCallback)

    const mockPage = {
      evaluate: vi.fn().mockResolvedValue(mockStats),
    } as any

    await monitor.start(mockPage)

    // Advance past one poll interval (default 5000ms)
    await vi.advanceTimersByTimeAsync(5100)

    expect(statsCallback).toHaveBeenCalledWith(mockStats)
    expect(monitor.getStats()).toEqual(mockStats)
  })

  it('should detect high packet loss degradation', async () => {
    const degradedCallback = vi.fn()
    monitor.onDegraded(degradedCallback)

    const mockPage = {
      evaluate: vi.fn().mockResolvedValue({
        packetsLost: 100, // Above default threshold of 50
        jitter: 0.01,
        roundTripTime: 0.05,
        bytesReceived: 10000,
      }),
    } as any

    await monitor.start(mockPage)
    await vi.advanceTimersByTimeAsync(5100)

    expect(degradedCallback).toHaveBeenCalledWith(
      expect.stringContaining('packet loss'),
      expect.objectContaining({ packetsLost: 100 }),
    )
  })

  it('should detect high jitter degradation', async () => {
    const monitor2 = new WebRTCMonitor({ jitterThreshold: 0.05 })
    const degradedCallback = vi.fn()
    monitor2.onDegraded(degradedCallback)

    const mockPage = {
      evaluate: vi.fn().mockResolvedValue({
        packetsLost: 0,
        jitter: 0.1, // Above threshold of 0.05
        roundTripTime: 0.05,
        bytesReceived: 10000,
      }),
    } as any

    await monitor2.start(mockPage)
    await vi.advanceTimersByTimeAsync(5100)

    expect(degradedCallback).toHaveBeenCalledWith(
      expect.stringContaining('jitter'),
      expect.objectContaining({ jitter: 0.1 }),
    )

    await monitor2.stop()
  })

  it('should not call degraded callback when stats are within thresholds', async () => {
    const degradedCallback = vi.fn()
    monitor.onDegraded(degradedCallback)

    const mockPage = {
      evaluate: vi.fn().mockResolvedValue({
        packetsLost: 2,
        jitter: 0.001,
        roundTripTime: 0.02,
        bytesReceived: 50000,
      }),
    } as any

    await monitor.start(mockPage)
    await vi.advanceTimersByTimeAsync(5100)

    expect(degradedCallback).not.toHaveBeenCalled()
  })

  it('should handle null stats from page gracefully', async () => {
    const statsCallback = vi.fn()
    monitor.onStats(statsCallback)

    const mockPage = {
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined) // start
        .mockResolvedValue(null), // readStats returns null
    } as any

    await monitor.start(mockPage)
    await vi.advanceTimersByTimeAsync(5100)

    // Should not call stats callback if stats are null
    expect(statsCallback).not.toHaveBeenCalled()
  })

  it('should handle page.evaluate errors during readStats gracefully', async () => {
    const statsCallback = vi.fn()
    monitor.onStats(statsCallback)

    const mockPage = {
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined) // start
        .mockRejectedValue(new Error('disconnected')), // readStats fails
    } as any

    await monitor.start(mockPage)
    await vi.advanceTimersByTimeAsync(5100)

    // Should not throw, just silently catch
    expect(statsCallback).not.toHaveBeenCalled()
  })
})


