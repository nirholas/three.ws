// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HealthMonitor } from '../../src/health'
import { EventEmitter } from 'events'

// Mock the space-ui module to avoid real browser interactions
vi.mock('../../src/browser/space-ui', () => ({
  getSpaceState: vi.fn(),
}))

import * as spaceUI from '../../src/browser/space-ui'

describe('HealthMonitor', () => {
  let monitor: HealthMonitor
  const mockGetSpaceState = vi.mocked(spaceUI.getSpaceState)

  beforeEach(() => {
    vi.useFakeTimers()
    mockGetSpaceState.mockReset()
    monitor = new HealthMonitor(1000) // 1s interval for testing
  })

  afterEach(() => {
    monitor.stop()
    vi.useRealTimers()
  })

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  it('should create with default interval', () => {
    const defaultMonitor = new HealthMonitor()
    // No error means success — default 10000ms
    defaultMonitor.stop()
  })

  it('should accept a custom interval', () => {
    const customMonitor = new HealthMonitor(5000)
    customMonitor.stop()
  })

  // ---------------------------------------------------------------------------
  // Page / Observer setters
  // ---------------------------------------------------------------------------

  it('should set page and observer without error', () => {
    const mockPage = {} as any
    const mockObserver = new EventEmitter() as any
    monitor.setPage(mockPage)
    monitor.setObserver(mockObserver)
    monitor.setSpaceUIOptions({ some: 'option' } as any)
  })

  // ---------------------------------------------------------------------------
  // Start / Stop
  // ---------------------------------------------------------------------------

  it('should start polling when page is set', async () => {
    const mockPage = {} as any
    monitor.setPage(mockPage)
    mockGetSpaceState.mockResolvedValue({ hasEnded: false })

    monitor.start()

    // Advance past one interval
    await vi.advanceTimersByTimeAsync(1100)

    expect(mockGetSpaceState).toHaveBeenCalledWith(mockPage, {})
  })

  it('should stop polling on stop()', async () => {
    const mockPage = {} as any
    monitor.setPage(mockPage)
    mockGetSpaceState.mockResolvedValue({ hasEnded: false })

    monitor.start()
    await vi.advanceTimersByTimeAsync(1100)
    const callCount = mockGetSpaceState.mock.calls.length

    monitor.stop()
    await vi.advanceTimersByTimeAsync(5000)

    // Should not have received more calls after stop
    expect(mockGetSpaceState.mock.calls.length).toBe(callCount)
  })

  it('should call stop() before starting new polling (idempotent)', () => {
    const mockPage = {} as any
    monitor.setPage(mockPage)
    mockGetSpaceState.mockResolvedValue({ hasEnded: false })

    monitor.start()
    monitor.start() // Should not create duplicate intervals
    monitor.stop()
  })

  // ---------------------------------------------------------------------------
  // Space ended detection via polling
  // ---------------------------------------------------------------------------

  it('should fire statusChange and spaceEnded handlers when space ends', async () => {
    const mockPage = {} as any
    monitor.setPage(mockPage)
    mockGetSpaceState.mockResolvedValue({ hasEnded: true })

    const statusHandler = vi.fn()
    const endedHandler = vi.fn()
    monitor.onStatusChange(statusHandler)
    monitor.onSpaceEnded(endedHandler)

    monitor.start()
    await vi.advanceTimersByTimeAsync(1100)

    expect(statusHandler).toHaveBeenCalledWith('space-ended')
    expect(endedHandler).toHaveBeenCalled()
  })

  it('should stop monitoring after space ends', async () => {
    const mockPage = {} as any
    monitor.setPage(mockPage)
    mockGetSpaceState
      .mockResolvedValueOnce({ hasEnded: true })

    const endedHandler = vi.fn()
    monitor.onSpaceEnded(endedHandler)

    monitor.start()
    await vi.advanceTimersByTimeAsync(1100)

    expect(endedHandler).toHaveBeenCalledTimes(1)

    // Further intervals should not fire
    mockGetSpaceState.mockResolvedValue({ hasEnded: true })
    await vi.advanceTimersByTimeAsync(5000)
    expect(endedHandler).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  it('should call error handler when health check throws', async () => {
    const mockPage = {} as any
    monitor.setPage(mockPage)
    mockGetSpaceState.mockRejectedValue(new Error('page crashed'))

    const errorHandler = vi.fn()
    monitor.onError(errorHandler)

    monitor.start()
    await vi.advanceTimersByTimeAsync(1100)

    expect(errorHandler).toHaveBeenCalledTimes(1)
    expect(errorHandler.mock.calls[0][0].message).toContain('page crashed')
  })

  // ---------------------------------------------------------------------------
  // Stop when page is null
  // ---------------------------------------------------------------------------

  it('should stop if page becomes null during polling tick', async () => {
    const mockPage = {} as any
    monitor.setPage(mockPage)
    mockGetSpaceState.mockResolvedValue({ hasEnded: false })

    monitor.start()
    await vi.advanceTimersByTimeAsync(1100) // first interval fires normally
    const callsBefore = mockGetSpaceState.mock.calls.length

    // Simulate page becoming null (e.g., browser closed)
    monitor.setPage(null as any)
    await vi.advanceTimersByTimeAsync(1100) // next interval fires, sees null page, stops

    // No additional getSpaceState calls after page became null
    expect(mockGetSpaceState.mock.calls.length).toBe(callsBefore)
  })

  // ---------------------------------------------------------------------------
  // Observer-based detection
  // ---------------------------------------------------------------------------

  it('should use observer events when observer is set', () => {
    const mockPage = {} as any
    const mockObserver = new EventEmitter() as any
    mockObserver.removeListener = vi.fn()

    monitor.setPage(mockPage)
    monitor.setObserver(mockObserver)

    const statusHandler = vi.fn()
    const endedHandler = vi.fn()
    monitor.onStatusChange(statusHandler)
    monitor.onSpaceEnded(endedHandler)

    monitor.start()

    // Simulate observer detecting space-ended DOM element
    mockObserver.emit('element:appeared', 'space-ended')

    expect(statusHandler).toHaveBeenCalledWith('space-ended')
    expect(endedHandler).toHaveBeenCalled()
  })

  it('should not react to observer events for non-space-ended elements', () => {
    const mockPage = {} as any
    const mockObserver = new EventEmitter() as any
    mockObserver.removeListener = vi.fn()

    monitor.setPage(mockPage)
    monitor.setObserver(mockObserver)

    const endedHandler = vi.fn()
    monitor.onSpaceEnded(endedHandler)

    monitor.start()

    mockObserver.emit('element:appeared', 'other-element')
    expect(endedHandler).not.toHaveBeenCalled()
  })

  it('should handle ws-closed event by checking space state', async () => {
    const mockPage = {} as any
    const mockObserver = new EventEmitter() as any
    mockObserver.removeListener = vi.fn()

    monitor.setPage(mockPage)
    monitor.setObserver(mockObserver)
    mockGetSpaceState.mockResolvedValue({ hasEnded: true })

    const endedHandler = vi.fn()
    monitor.onSpaceEnded(endedHandler)

    monitor.start()

    // Simulate WebSocket close
    mockObserver.emit('network:ws-closed')

    // Wait for the async check
    await vi.advanceTimersByTimeAsync(10)

    expect(endedHandler).toHaveBeenCalled()
  })

  it('should treat ws-closed + getSpaceState error as ended', async () => {
    const mockPage = {} as any
    const mockObserver = new EventEmitter() as any
    mockObserver.removeListener = vi.fn()

    monitor.setPage(mockPage)
    monitor.setObserver(mockObserver)
    mockGetSpaceState.mockRejectedValue(new Error('page closed'))

    const endedHandler = vi.fn()
    monitor.onSpaceEnded(endedHandler)

    monitor.start()

    mockObserver.emit('network:ws-closed')
    await vi.advanceTimersByTimeAsync(10)

    expect(endedHandler).toHaveBeenCalled()
  })

  it('should use triple interval when observer is active', async () => {
    const mockPage = {} as any
    const mockObserver = new EventEmitter() as any
    mockObserver.removeListener = vi.fn()

    monitor.setPage(mockPage)
    monitor.setObserver(mockObserver)
    mockGetSpaceState.mockResolvedValue({ hasEnded: false })

    monitor.start()

    // At normal 1s interval, it would fire. With observer, interval is 3s (1000*3).
    // After 1.1s, only the immediate check (if any) would have run, but setInterval
    // hasn't fired yet at 3s. Let's check calls at 2s -- no interval tick yet.
    await vi.advanceTimersByTimeAsync(2900)
    const callsBefore = mockGetSpaceState.mock.calls.length

    // After total 3100ms, the first interval tick (at 3000ms) should have fired
    await vi.advanceTimersByTimeAsync(200) // total ~3.1s
    expect(mockGetSpaceState.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('should unbind observer on stop', () => {
    const mockObserver = new EventEmitter() as any
    const removeListenerSpy = vi.spyOn(mockObserver, 'removeListener')

    monitor.setPage({} as any)
    monitor.setObserver(mockObserver)
    monitor.start()
    monitor.stop()

    expect(removeListenerSpy).toHaveBeenCalledWith('element:appeared', expect.any(Function))
    expect(removeListenerSpy).toHaveBeenCalledWith('network:ws-closed', expect.any(Function))
  })
})


