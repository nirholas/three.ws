// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§86]

import type { EchoCancellerConfig } from './types';

/**
 * Echo canceller that allows hearing other speakers during TTS playback.
 *
 * Instead of muting all capture while TTS plays (losing other speakers' audio),
 * this uses energy-comparison gating and high-pass filtering to distinguish
 * between our own echo and genuine speech from other participants.
 *
 * Strategy:
 * 1. Track the energy level of what we're injecting (TTS audio)
 * 2. Compare captured audio energy against injection energy
 * 3. If captured energy significantly exceeds injection energy, someone else is speaking
 * 4. Apply high-pass filtering during injection to remove low-frequency echo components
 */
export class EchoCanceller {
  private injecting = false;
  private injectionEnergy = 0;
  private readonly energyRatio: number;
  private readonly highPassCutoffHz: number;
  private prevSample = 0; // For single-pole high-pass filter state

  constructor(config?: EchoCancellerConfig) {
    this.energyRatio = config?.energyRatio ?? 1.5;
    this.highPassCutoffHz = config?.highPassCutoffHz ?? 300;
  }

  /** Update the injection state and energy level of outbound audio. */
  setInjecting(active: boolean, energy?: number): void {
    this.injecting = active;
    if (energy !== undefined) {
      this.injectionEnergy = energy;
    }
    if (!active) {
      this.injectionEnergy = 0;
      this.prevSample = 0;
    }
  }

  /** Whether audio is currently being injected. */
  isInjecting(): boolean {
    return this.injecting;
  }

  /**
   * Process a captured audio frame.
   * Returns the frame with echo removed, or null if it's entirely echo.
   */
  process(frame: Float32Array): { frame: Float32Array | null; echoDetected: boolean } {
    if (!this.injecting) {
      return { frame, echoDetected: false };
    }

    const energy = this.calculateEnergy(frame);

    // If energy is close to or below what we're injecting, it's likely echo
    const echoThreshold = this.injectionEnergy * this.energyRatio;
    if (energy < echoThreshold && this.injectionEnergy > 0.0001) {
      return { frame: null, echoDetected: true };
    }

    // Energy significantly exceeds our injection — someone else is speaking
    // Apply high-pass filter to remove low-frequency echo components
    const filtered = this.highPassFilter(frame);
    return { frame: filtered, echoDetected: false };
  }

  /** Calculate the RMS energy of a frame. */
  private calculateEnergy(frame: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i] * frame[i];
    }
    return sum / frame.length;
  }

  /**
   * Simple single-pole high-pass filter.
   * Removes frequencies below cutoffHz to strip echo fundamentals while
   * preserving speech formants.
   */
  private highPassFilter(frame: Float32Array): Float32Array {
    // RC time constant for desired cutoff
    // alpha = RC / (RC + dt), where RC = 1/(2*pi*fc), dt = 1/sampleRate
    // For 16kHz sample rate and 300Hz cutoff:
    const sampleRate = 16000;
    const rc = 1 / (2 * Math.PI * this.highPassCutoffHz);
    const dt = 1 / sampleRate;
    const alpha = rc / (rc + dt);

    const output = new Float32Array(frame.length);
    let prev = this.prevSample;

    for (let i = 0; i < frame.length; i++) {
      output[i] = alpha * (prev + frame[i] - (i > 0 ? frame[i - 1] : frame[i]));
      prev = output[i];
    }

    this.prevSample = prev;
    return output;
  }

  /** Reset internal state. */
  reset(): void {
    this.injecting = false;
    this.injectionEnergy = 0;
    this.prevSample = 0;
  }
}


