// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

import { describe, it, expect } from 'vitest'
import { AudioMeter } from '../../../src/audio/meter'

describe('AudioMeter', () => {
  function makeFrame(value: number, length = 1024): Float32Array {
    return new Float32Array(length).fill(value)
  }

  it('should start with zero levels', () => {
    const meter = new AudioMeter()
    const levels = meter.getLevels()
    expect(levels.inbound).toBe(0)
    expect(levels.outbound).toBe(0)
    expect(levels.peak).toBe(0)
  })

  it('should update inbound level', () => {
    const meter = new AudioMeter()
    meter.updateInbound(makeFrame(0.5))

    const levels = meter.getLevels()
    expect(levels.inbound).toBeCloseTo(0.5, 2)
    expect(levels.peak).toBeCloseTo(0.5, 2)
  })

  it('should update outbound level', () => {
    const meter = new AudioMeter()
    meter.updateOutbound(makeFrame(0.3))

    const levels = meter.getLevels()
    expect(levels.outbound).toBeCloseTo(0.3, 2)
  })

  it('should decay peak over time', () => {
    const meter = new AudioMeter(0.5) // Fast decay for testing
    meter.updateInbound(makeFrame(0.8))
    const peak1 = meter.getLevels().peak

    // Update with lower level — peak should decay
    meter.updateInbound(makeFrame(0.1))
    const peak2 = meter.getLevels().peak

    // Peak decayed from 0.8 * 0.5 = 0.4, but max(0.4, 0.1) = 0.4
    expect(peak2).toBeLessThan(peak1)
  })

  it('should return percentage values for UI', () => {
    const meter = new AudioMeter()
    meter.updateInbound(makeFrame(0.05))
    meter.updateOutbound(makeFrame(0.03))

    expect(meter.getInboundPercent()).toBe(50)
    expect(meter.getOutboundPercent()).toBe(30)
  })

  it('should clamp percentage to 100', () => {
    const meter = new AudioMeter()
    meter.updateInbound(makeFrame(0.9)) // RMS = 0.9, *1000 = 900, clamped to 100

    expect(meter.getInboundPercent()).toBe(100)
  })

  it('should return a copy from getLevels', () => {
    const meter = new AudioMeter()
    const levels1 = meter.getLevels()
    meter.updateInbound(makeFrame(0.5))
    const levels2 = meter.getLevels()

    // Original copy should be unchanged
    expect(levels1.inbound).toBe(0)
    expect(levels2.inbound).toBeCloseTo(0.5, 2)
  })

  it('should reset all levels', () => {
    const meter = new AudioMeter()
    meter.updateInbound(makeFrame(0.5))
    meter.updateOutbound(makeFrame(0.3))
    meter.reset()

    const levels = meter.getLevels()
    expect(levels.inbound).toBe(0)
    expect(levels.outbound).toBe(0)
    expect(levels.peak).toBe(0)
  })
})


