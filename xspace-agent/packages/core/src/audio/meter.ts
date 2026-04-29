// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

import type { AudioLevels } from './types';

/**
 * Audio level meter that tracks inbound and outbound levels
 * for real-time display in the admin panel.
 *
 * Maintains RMS levels with peak hold and decay for smooth UI rendering.
 */
export class AudioMeter {
  private levels: AudioLevels = { inbound: 0, outbound: 0, peak: 0 };
  private readonly peakDecay: number;

  constructor(peakDecay = 0.95) {
    this.peakDecay = peakDecay;
  }

  /** Update inbound (captured from Space) audio level. */
  updateInbound(frame: Float32Array): void {
    const rms = this.calculateRMS(frame);
    this.levels.inbound = rms;
    this.levels.peak = Math.max(this.levels.peak * this.peakDecay, rms);
  }

  /** Update outbound (TTS injection) audio level. */
  updateOutbound(frame: Float32Array): void {
    const rms = this.calculateRMS(frame);
    this.levels.outbound = rms;
  }

  /** Get current audio levels (returns a copy). */
  getLevels(): AudioLevels {
    return { ...this.levels };
  }

  /** Returns inbound level on a 0–100 scale for UI display. */
  getInboundPercent(): number {
    return Math.min(100, Math.round(this.levels.inbound * 1000));
  }

  /** Returns outbound level on a 0–100 scale for UI display. */
  getOutboundPercent(): number {
    return Math.min(100, Math.round(this.levels.outbound * 1000));
  }

  private calculateRMS(frame: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i] * frame[i];
    }
    return Math.sqrt(sum / frame.length);
  }

  /** Reset all levels. */
  reset(): void {
    this.levels = { inbound: 0, outbound: 0, peak: 0 };
  }
}


