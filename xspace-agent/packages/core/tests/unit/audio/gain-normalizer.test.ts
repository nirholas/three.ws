// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { describe, it, expect } from 'vitest'
import { GainNormalizer } from '../../../src/audio/gain-normalizer'

describe('GainNormalizer', () => {
  function makeFrame(value: number, length = 1024): Float32Array {
    return new Float32Array(length).fill(value)
  }

  function calculateRMS(frame: Float32Array): number {
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
    return Math.sqrt(sum / frame.length)
  }

  it('should not amplify silence', () => {
    const gn = new GainNormalizer()
    const silent = makeFrame(0.0005)
    const result = gn.normalizeOutbound(silent)
    expect(result).toBe(silent) // Same reference — returned as-is
  })

  it('should normalize quiet audio towards target RMS', () => {
    const gn = new GainNormalizer({ targetRMS: 0.1, smoothingFactor: 0 })
    const quiet = makeFrame(0.01) // RMS = 0.01
    const result = gn.normalizeOutbound(quiet)
    const resultRMS = calculateRMS(result)
    // With smoothing=0, gain jumps directly to target/actual = 10x
    // But clamped to maxGain=5, so resultRMS ~= 0.05
    expect(resultRMS).toBeGreaterThan(0.01) // Louder than input
  })

  it('should clamp output to [-1, 1]', () => {
    const gn = new GainNormalizer({ targetRMS: 0.5, smoothingFactor: 0 })
    const loud = makeFrame(0.8) // With 5x gain would exceed 1.0
    const result = gn.normalizeOutbound(loud)
    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(-1)
      expect(result[i]).toBeLessThanOrEqual(1)
    }
  })

  it('should learn target level from incoming audio', () => {
    const gn = new GainNormalizer({ targetRMS: 0.1, smoothingFactor: 0.5 })
    const initial = gn.getTargetRMS()

    // Feed loud incoming audio
    const loudFrame = makeFrame(0.5)
    gn.learnLevel(loudFrame)

    // Target should have moved towards 0.5
    expect(gn.getTargetRMS()).toBeGreaterThan(initial)
  })

  it('should not learn from silent frames', () => {
    const gn = new GainNormalizer({ targetRMS: 0.1 })
    const initial = gn.getTargetRMS()

    // Feed near-silent audio
    const silentFrame = makeFrame(0.005) // Below 0.01 threshold
    gn.learnLevel(silentFrame)

    expect(gn.getTargetRMS()).toBe(initial)
  })

  it('should respect maxGain', () => {
    const gn = new GainNormalizer({ targetRMS: 1.0, maxGain: 2.0, smoothingFactor: 0 })
    const quiet = makeFrame(0.01)
    gn.normalizeOutbound(quiet)
    expect(gn.getCurrentGain()).toBeLessThanOrEqual(2.0)
  })

  it('should reset gain to 1.0', () => {
    const gn = new GainNormalizer({ smoothingFactor: 0 })
    gn.normalizeOutbound(makeFrame(0.01)) // Changes gain
    gn.reset()
    expect(gn.getCurrentGain()).toBe(1.0)
  })
})


