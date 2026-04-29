// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import type { GainNormalizerConfig } from './types';

/**
 * Gain normalizer that produces consistent volume levels across
 * different speakers and TTS output.
 *
 * - Learns the target level from incoming Space audio (other speakers)
 * - Normalizes outbound TTS audio to match those levels
 * - Uses EMA-smoothed gain changes to avoid clicks and pops
 */
export class GainNormalizer {
  private targetRMS: number;
  private readonly smoothingFactor: number;
  private readonly maxGain: number;
  private currentGain = 1.0;

  constructor(config?: GainNormalizerConfig) {
    this.targetRMS = config?.targetRMS ?? 0.1;
    this.smoothingFactor = config?.smoothingFactor ?? 0.95;
    this.maxGain = config?.maxGain ?? 5.0;
  }

  /**
   * Normalize outbound TTS audio to match Space volume levels.
   * Returns a new buffer with adjusted gain.
   */
  normalizeOutbound(frame: Float32Array): Float32Array {
    const rms = this.calculateRMS(frame);
    if (rms < 0.001) return frame; // Don't amplify silence

    const desiredGain = this.targetRMS / rms;
    // Smooth gain changes to avoid clicks
    this.currentGain =
      this.smoothingFactor * this.currentGain +
      (1 - this.smoothingFactor) * desiredGain;
    // Clamp gain to prevent distortion
    this.currentGain = Math.min(this.currentGain, this.maxGain);

    const normalized = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      normalized[i] = Math.max(-1, Math.min(1, frame[i] * this.currentGain));
    }
    return normalized;
  }

  /**
   * Learn the target output level from incoming Space audio.
   * Only updates from non-silent frames to avoid pulling the target down.
   */
  learnLevel(frame: Float32Array): void {
    const rms = this.calculateRMS(frame);
    if (rms > 0.01) {
      // Only learn from frames with meaningful audio
      this.targetRMS =
        this.smoothingFactor * this.targetRMS +
        (1 - this.smoothingFactor) * rms;
    }
  }

  /** Get the current target RMS level. */
  getTargetRMS(): number {
    return this.targetRMS;
  }

  /** Get the current gain multiplier. */
  getCurrentGain(): number {
    return this.currentGain;
  }

  private calculateRMS(frame: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i] * frame[i];
    }
    return Math.sqrt(sum / frame.length);
  }

  /** Reset to initial state. */
  reset(): void {
    this.currentGain = 1.0;
  }
}


