// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ResponsePacer } from '../../../src/turns/pacing'

describe('ResponsePacer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ---------------------------------------------------------------------------
  // Construction and defaults
  // ---------------------------------------------------------------------------

  it('should use default delays and jitter', () => {
    const pacer = new ResponsePacer()
    expect(pacer.getPace()).toBe('normal')
    expect(pacer.getBaseDelay()).toBe(800) // default normal delay
  })

  it('should accept custom delays', () => {
    const pacer = new ResponsePacer({
      delays: { rapid: 100, normal: 500, slow: 2000 },
    })
    expect(pacer.getBaseDelay()).toBe(500)
  })

  it('should use partial delay overrides', () => {
    const pacer = new ResponsePacer({
      delays: { rapid: 100 },
    })
    // rapid overridden, others use defaults
    pacer.setPace('rapid')
    expect(pacer.getBaseDelay()).toBe(100)

    pacer.setPace('normal')
    expect(pacer.getBaseDelay()).toBe(800) // default

    pacer.setPace('slow')
    expect(pacer.getBaseDelay()).toBe(1500) // default
  })

  it('should accept custom maxJitter', () => {
    const pacer = new ResponsePacer({ maxJitterMs: 0 })
    // With 0 jitter, delay should be exactly the base delay
    expect(pacer.getBaseDelay()).toBe(800)
  })

  // ---------------------------------------------------------------------------
  // setPace / getPace
  // ---------------------------------------------------------------------------

  it('should get and set the pace', () => {
    const pacer = new ResponsePacer()
    expect(pacer.getPace()).toBe('normal')

    pacer.setPace('rapid')
    expect(pacer.getPace()).toBe('rapid')

    pacer.setPace('slow')
    expect(pacer.getPace()).toBe('slow')
  })

  // ---------------------------------------------------------------------------
  // getBaseDelay
  // ---------------------------------------------------------------------------

  it('should return correct base delay for each pace', () => {
    const pacer = new ResponsePacer()

    pacer.setPace('rapid')
    expect(pacer.getBaseDelay()).toBe(300)

    pacer.setPace('normal')
    expect(pacer.getBaseDelay()).toBe(800)

    pacer.setPace('slow')
    expect(pacer.getBaseDelay()).toBe(1500)
  })

  // ---------------------------------------------------------------------------
  // preResponseDelay
  // ---------------------------------------------------------------------------

  it('should delay by at least the base delay', async () => {
    const pacer = new ResponsePacer({ maxJitterMs: 0 })
    pacer.setPace('normal')

    const promise = pacer.preResponseDelay()

    // Advance less than base delay — should not resolve
    vi.advanceTimersByTime(799)
    await vi.advanceTimersByTimeAsync(0)

    // Advance past base delay
    vi.advanceTimersByTime(10)
    await promise // Should resolve now
  })

  it('should add random jitter to the delay', async () => {
    // Mock Math.random to return a known value
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    const pacer = new ResponsePacer({ maxJitterMs: 200 })
    pacer.setPace('normal')

    const promise = pacer.preResponseDelay()

    // Base = 800, jitter = 0.5 * 200 = 100, total = 900
    vi.advanceTimersByTime(899)
    await vi.advanceTimersByTimeAsync(0)

    vi.advanceTimersByTime(10)
    await promise
  })

  it('should have shorter delay for rapid pace', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const pacer = new ResponsePacer({ maxJitterMs: 0 })
    pacer.setPace('rapid')

    const promise = pacer.preResponseDelay()
    vi.advanceTimersByTime(300)
    await promise
  })

  it('should have longer delay for slow pace', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const pacer = new ResponsePacer({ maxJitterMs: 0 })
    pacer.setPace('slow')

    const promise = pacer.preResponseDelay()

    // Should not resolve at 1400ms
    vi.advanceTimersByTime(1400)
    await vi.advanceTimersByTimeAsync(0)

    // Should resolve at 1500ms
    vi.advanceTimersByTime(100)
    await promise
  })

  // ---------------------------------------------------------------------------
  // shouldSendThinkingSignal
  // ---------------------------------------------------------------------------

  it('should only send thinking signal in slow pace', () => {
    const pacer = new ResponsePacer()

    pacer.setPace('rapid')
    expect(pacer.shouldSendThinkingSignal()).toBe(false)

    pacer.setPace('normal')
    expect(pacer.shouldSendThinkingSignal()).toBe(false)

    pacer.setPace('slow')
    expect(pacer.shouldSendThinkingSignal()).toBe(true)
  })
})


