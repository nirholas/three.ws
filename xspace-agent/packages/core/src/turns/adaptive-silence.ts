// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

import type { ConversationPace } from '../types'

export interface AdaptiveSilenceConfig {
  /** Base silence threshold in ms (default: 1500) */
  baseThresholdMs?: number
  /** Minimum allowed threshold in ms (default: 500) */
  minThresholdMs?: number
  /** Maximum allowed threshold in ms (default: 3000) */
  maxThresholdMs?: number
  /** Maximum number of recent gaps to track (default: 20) */
  windowSize?: number
}

export class AdaptiveSilenceDetector {
  private recentGaps: number[] = []
  private readonly baseThreshold: number
  private readonly minThreshold: number
  private readonly maxThreshold: number
  private readonly windowSize: number

  constructor(config: AdaptiveSilenceConfig = {}) {
    this.baseThreshold = config.baseThresholdMs ?? 1500
    this.minThreshold = config.minThresholdMs ?? 500
    this.maxThreshold = config.maxThresholdMs ?? 3000
    this.windowSize = config.windowSize ?? 20
  }

  /** Record a silence gap between speech segments */
  recordGap(gapMs: number): void {
    this.recentGaps.push(gapMs)
    if (this.recentGaps.length > this.windowSize) {
      this.recentGaps.shift()
    }
  }

  /** Get the current adaptive threshold in ms */
  getThreshold(): number {
    if (this.recentGaps.length < 3) return this.baseThreshold

    // Calculate median gap
    const sorted = [...this.recentGaps].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]

    // Threshold = median gap * 1.5, clamped
    const adaptive = median * 1.5
    return Math.max(this.minThreshold, Math.min(this.maxThreshold, adaptive))
  }

  /** Get the current conversation pace descriptor */
  getPace(): ConversationPace {
    const threshold = this.getThreshold()
    if (threshold < 800) return 'rapid'
    if (threshold > 2000) return 'slow'
    return 'normal'
  }

  /** Get the number of recorded gaps */
  getGapCount(): number {
    return this.recentGaps.length
  }

  /** Reset all recorded gaps */
  reset(): void {
    this.recentGaps = []
  }
}


