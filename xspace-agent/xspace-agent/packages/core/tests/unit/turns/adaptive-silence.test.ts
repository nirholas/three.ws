// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

import { describe, it, expect } from 'vitest'
import { AdaptiveSilenceDetector } from '../../../src/turns/adaptive-silence'

describe('AdaptiveSilenceDetector', () => {
  // ---------------------------------------------------------------------------
  // Construction and defaults
  // ---------------------------------------------------------------------------

  it('should use default configuration values', () => {
    const detector = new AdaptiveSilenceDetector()
    expect(detector.getThreshold()).toBe(1500) // base threshold (< 3 gaps)
    expect(detector.getGapCount()).toBe(0)
    expect(detector.getPace()).toBe('normal') // 1500ms -> normal
  })

  it('should accept custom configuration', () => {
    const detector = new AdaptiveSilenceDetector({
      baseThresholdMs: 2000,
      minThresholdMs: 300,
      maxThresholdMs: 5000,
      windowSize: 10,
    })
    expect(detector.getThreshold()).toBe(2000)
  })

  // ---------------------------------------------------------------------------
  // recordGap
  // ---------------------------------------------------------------------------

  it('should record gaps and increment gap count', () => {
    const detector = new AdaptiveSilenceDetector()
    detector.recordGap(500)
    expect(detector.getGapCount()).toBe(1)
    detector.recordGap(600)
    expect(detector.getGapCount()).toBe(2)
  })

  it('should enforce windowSize by dropping oldest gaps', () => {
    const detector = new AdaptiveSilenceDetector({ windowSize: 3 })
    detector.recordGap(100)
    detector.recordGap(200)
    detector.recordGap(300)
    expect(detector.getGapCount()).toBe(3)

    detector.recordGap(400)
    expect(detector.getGapCount()).toBe(3) // Oldest (100) removed
  })

  // ---------------------------------------------------------------------------
  // getThreshold — base threshold when < 3 gaps
  // ---------------------------------------------------------------------------

  it('should return base threshold when fewer than 3 gaps recorded', () => {
    const detector = new AdaptiveSilenceDetector({ baseThresholdMs: 1500 })
    detector.recordGap(500)
    detector.recordGap(600)
    expect(detector.getThreshold()).toBe(1500) // Still uses base
  })

  // ---------------------------------------------------------------------------
  // getThreshold — adaptive threshold
  // ---------------------------------------------------------------------------

  it('should compute adaptive threshold from median * 1.5', () => {
    const detector = new AdaptiveSilenceDetector({
      minThresholdMs: 0,
      maxThresholdMs: 10000,
    })

    // Record 5 gaps: [200, 400, 600, 800, 1000]
    detector.recordGap(200)
    detector.recordGap(400)
    detector.recordGap(600)
    detector.recordGap(800)
    detector.recordGap(1000)

    // Median of sorted [200, 400, 600, 800, 1000] = 600
    // Adaptive = 600 * 1.5 = 900
    expect(detector.getThreshold()).toBe(900)
  })

  it('should clamp threshold to minThresholdMs', () => {
    const detector = new AdaptiveSilenceDetector({
      minThresholdMs: 500,
      maxThresholdMs: 3000,
    })

    // Record very short gaps
    detector.recordGap(100)
    detector.recordGap(100)
    detector.recordGap(100)

    // Median = 100, adaptive = 150, but clamped to 500
    expect(detector.getThreshold()).toBe(500)
  })

  it('should clamp threshold to maxThresholdMs', () => {
    const detector = new AdaptiveSilenceDetector({
      minThresholdMs: 500,
      maxThresholdMs: 3000,
    })

    // Record very long gaps
    detector.recordGap(5000)
    detector.recordGap(5000)
    detector.recordGap(5000)

    // Median = 5000, adaptive = 7500, but clamped to 3000
    expect(detector.getThreshold()).toBe(3000)
  })

  it('should use floor for median index on even-length arrays', () => {
    const detector = new AdaptiveSilenceDetector({
      minThresholdMs: 0,
      maxThresholdMs: 10000,
    })

    // 4 gaps: [200, 400, 600, 800] -> sorted, floor(4/2)=2 -> index 2 -> 600
    detector.recordGap(200)
    detector.recordGap(400)
    detector.recordGap(600)
    detector.recordGap(800)

    // Median at index 2 = 600, threshold = 600 * 1.5 = 900
    expect(detector.getThreshold()).toBe(900)
  })

  // ---------------------------------------------------------------------------
  // getPace
  // ---------------------------------------------------------------------------

  it('should return "rapid" when threshold < 800', () => {
    const detector = new AdaptiveSilenceDetector({
      minThresholdMs: 0,
      maxThresholdMs: 10000,
    })

    // Gaps that produce threshold < 800
    // Need median * 1.5 < 800 => median < 533
    detector.recordGap(300)
    detector.recordGap(300)
    detector.recordGap(300)

    // Threshold = 300 * 1.5 = 450
    expect(detector.getPace()).toBe('rapid')
  })

  it('should return "slow" when threshold > 2000', () => {
    const detector = new AdaptiveSilenceDetector({
      minThresholdMs: 0,
      maxThresholdMs: 10000,
    })

    // Need median * 1.5 > 2000 => median > 1333
    detector.recordGap(2000)
    detector.recordGap(2000)
    detector.recordGap(2000)

    // Threshold = 2000 * 1.5 = 3000
    expect(detector.getPace()).toBe('slow')
  })

  it('should return "normal" for mid-range thresholds', () => {
    const detector = new AdaptiveSilenceDetector({
      minThresholdMs: 0,
      maxThresholdMs: 10000,
    })

    // Need 800 <= threshold <= 2000 => 533 <= median <= 1333
    detector.recordGap(800)
    detector.recordGap(800)
    detector.recordGap(800)

    // Threshold = 800 * 1.5 = 1200
    expect(detector.getPace()).toBe('normal')
  })

  it('should return "normal" when fewer than 3 gaps (base threshold 1500)', () => {
    const detector = new AdaptiveSilenceDetector()
    expect(detector.getPace()).toBe('normal')
  })

  // ---------------------------------------------------------------------------
  // reset
  // ---------------------------------------------------------------------------

  it('should reset all recorded gaps', () => {
    const detector = new AdaptiveSilenceDetector()
    detector.recordGap(500)
    detector.recordGap(600)
    detector.recordGap(700)

    detector.reset()
    expect(detector.getGapCount()).toBe(0)
    expect(detector.getThreshold()).toBe(1500) // Back to base
  })

  // ---------------------------------------------------------------------------
  // Adaptive behavior over time
  // ---------------------------------------------------------------------------

  it('should adapt threshold as conversation pace changes', () => {
    const detector = new AdaptiveSilenceDetector({
      minThresholdMs: 0,
      maxThresholdMs: 10000,
    })

    // Start with fast-paced gaps
    detector.recordGap(200)
    detector.recordGap(200)
    detector.recordGap(200)
    expect(detector.getThreshold()).toBe(300) // 200 * 1.5

    // Gradually shift to slower pace
    detector.recordGap(1000)
    detector.recordGap(1000)
    detector.recordGap(1000)

    // With window size 20, all 6 gaps are still in the window
    // Sorted: [200, 200, 200, 1000, 1000, 1000], median at index 3 = 1000
    expect(detector.getThreshold()).toBe(1500) // 1000 * 1.5
  })
})


