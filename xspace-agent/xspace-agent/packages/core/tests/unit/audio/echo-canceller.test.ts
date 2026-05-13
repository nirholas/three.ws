// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import { describe, it, expect } from 'vitest'
import { EchoCanceller } from '../../../src/audio/echo-canceller'

describe('EchoCanceller', () => {
  function makeFrame(value: number, length = 4096): Float32Array {
    return new Float32Array(length).fill(value)
  }

  it('should pass through frames when not injecting', () => {
    const ec = new EchoCanceller()
    const frame = makeFrame(0.5)

    const { frame: result, echoDetected } = ec.process(frame)
    expect(result).toBe(frame) // Same reference — no processing needed
    expect(echoDetected).toBe(false)
  })

  it('should detect echo when captured energy matches injection energy', () => {
    const ec = new EchoCanceller()

    // Simulate TTS injection with known energy
    const energy = 0.25 * 0.25 // RMS energy of 0.25-amplitude signal
    ec.setInjecting(true, energy)

    // Captured frame with similar energy — should be detected as echo
    const frame = makeFrame(0.2) // energy = 0.04, below threshold 0.25*0.25*1.5 = 0.09375
    const { frame: result, echoDetected } = ec.process(frame)
    expect(result).toBeNull()
    expect(echoDetected).toBe(true)
  })

  it('should pass through when captured energy significantly exceeds injection', () => {
    const ec = new EchoCanceller()

    // Low injection energy
    ec.setInjecting(true, 0.001)

    // High captured energy — someone else is speaking
    const frame = makeFrame(0.5)
    const { frame: result, echoDetected } = ec.process(frame)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(frame.length)
    expect(echoDetected).toBe(false)
  })

  it('should reset state when injection ends', () => {
    const ec = new EchoCanceller()
    ec.setInjecting(true, 0.1)
    expect(ec.isInjecting()).toBe(true)

    ec.setInjecting(false)
    expect(ec.isInjecting()).toBe(false)

    // After injection ends, frames pass through unmodified
    const frame = makeFrame(0.01)
    const { frame: result, echoDetected } = ec.process(frame)
    expect(result).toBe(frame)
    expect(echoDetected).toBe(false)
  })

  it('should respect custom energy ratio', () => {
    const ec = new EchoCanceller({ energyRatio: 3.0 })

    ec.setInjecting(true, 0.01) // injection energy 0.01

    // Energy 0.02 — above 0.01*1.5 default but below 0.01*3.0
    const frame = makeFrame(0.15) // energy ~0.0225
    const { echoDetected } = ec.process(frame)
    expect(echoDetected).toBe(true) // 0.0225 < 0.01 * 3.0 = 0.03
  })

  it('should reset all state', () => {
    const ec = new EchoCanceller()
    ec.setInjecting(true, 0.5)
    ec.reset()

    expect(ec.isInjecting()).toBe(false)
  })
})


