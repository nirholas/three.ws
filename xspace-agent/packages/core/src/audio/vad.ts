// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

export interface VADConfig {
  /** Manual threshold override — disables adaptive mode when set. */
  threshold?: number;
  /** Enable adaptive threshold based on ambient noise level (default: true). */
  adaptive?: boolean;
  /** Minimum continuous speech duration before a segment is accepted (default: 250ms). */
  minSpeechDurationMs?: number;
  /** Silence duration that closes a speech segment (default: 1500ms). */
  maxSilenceDurationMs?: number;
  /** Sample rate used for duration calculations (default: 16000). */
  sampleRate?: number;
  // Legacy options kept for backward compatibility
  /** @deprecated Use maxSilenceDurationMs. */
  silenceThresholdMs?: number;
  /** Minimum speech chunks required before firing callback. Overrides minSpeechDurationMs. */
  minChunks?: number;
}

/** @deprecated Use VADConfig. */
export type VoiceActivityDetectorOptions = VADConfig;

// Minimum RMS energy floor — prevents triggering on digital silence
const NOISE_FLOOR_MIN = 0.0001;
// Speech threshold multiplier relative to ambient noise floor
const NOISE_FLOOR_MULTIPLIER = 2.5;
// EMA smoothing factor for noise floor updates (applied only during silence)
const NOISE_FLOOR_ALPHA = 0.05;

export class VoiceActivityDetector {
  private readonly maxSilenceDurationMs: number;
  private readonly minChunks: number;
  private readonly adaptive: boolean;
  private readonly fixedThreshold: number | undefined;
  private noiseFloor: number;
  private chunks: Buffer[];
  private silenceTimer: ReturnType<typeof setTimeout> | null;
  private onSpeechEnd: ((chunks: Buffer[]) => void) | null;
  private silenceOverride: number | null = null;
  private lastSpeechEndTime = 0;
  private onGapDetected: ((gapMs: number) => void) | null = null;

  constructor(options?: VADConfig) {
    this.maxSilenceDurationMs =
      options?.maxSilenceDurationMs ?? options?.silenceThresholdMs ?? 1500;
    const sampleRate = options?.sampleRate ?? 16000;
    // Derive minimum chunks from minSpeechDurationMs if minChunks not explicitly set;
    // assumes 4096-sample chunks as produced by the ScriptProcessor in bridge.ts
    const chunkDurationMs = (4096 / sampleRate) * 1000;
    this.minChunks =
      options?.minChunks ??
      Math.max(1, Math.ceil((options?.minSpeechDurationMs ?? 250) / chunkDurationMs));
    this.adaptive = options?.adaptive ?? true;
    this.fixedThreshold = options?.threshold;
    this.noiseFloor = 0;
    this.chunks = [];
    this.silenceTimer = null;
    this.onSpeechEnd = null;
  }

  private computeRMS(float32: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < float32.length; i++) {
      sum += float32[i] * float32[i];
    }
    return Math.sqrt(sum / float32.length);
  }

  private getThreshold(): number {
    if (this.fixedThreshold !== undefined) return this.fixedThreshold;
    if (!this.adaptive) return 0.001;
    return Math.max(NOISE_FLOOR_MIN, this.noiseFloor * NOISE_FLOOR_MULTIPLIER);
  }

  /**
   * Feed audio data. Fires the onSpeechEnd callback when speech ends
   * (detected by silence exceeding the threshold).
   */
  feed(pcmBase64: string): void {
    const raw = Buffer.from(pcmBase64, "base64");
    if (raw.byteLength < 4) return;

    const float32 = new Float32Array(
      raw.buffer,
      raw.byteOffset,
      raw.byteLength / 4
    );

    const rms = this.computeRMS(float32);
    const threshold = this.getThreshold();
    const isSpeech = rms >= threshold;

    if (!isSpeech) {
      // Update noise floor estimate using only silence chunks
      this.noiseFloor += NOISE_FLOOR_ALPHA * (rms - this.noiseFloor);
    }

    if (isSpeech) {
      // Record gap between speech segments for adaptive silence tracking
      if (this.chunks.length === 0 && this.lastSpeechEndTime > 0) {
        const gapMs = Date.now() - this.lastSpeechEndTime;
        this.onGapDetected?.(gapMs);
      }

      this.chunks.push(raw);

      // Reset silence timer whenever we get speech
      if (this.silenceTimer !== null) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    } else if (this.chunks.length > 0) {
      // We have accumulated speech chunks and now detect silence.
      // Start (or restart) the silence timer.
      if (this.silenceTimer === null) {
        const effectiveSilence = this.silenceOverride ?? this.maxSilenceDurationMs;
        this.silenceTimer = setTimeout(() => {
          this.flush();
        }, effectiveSilence);
      }
    }
  }

  /**
   * Set the callback for when a speech segment ends.
   */
  onSpeech(callback: (chunks: Buffer[]) => void): void {
    this.onSpeechEnd = callback;
  }

  /**
   * Register a callback that fires whenever a gap between speech segments is detected.
   * The gap duration (ms) is passed to the callback for adaptive silence tracking.
   */
  onGap(callback: (gapMs: number) => void): void {
    this.onGapDetected = callback;
  }

  /**
   * Override the silence duration threshold at runtime.
   * Pass null to revert to the configured default.
   */
  setSilenceDuration(ms: number | null): void {
    this.silenceOverride = ms;
  }

  /** Get the effective silence duration threshold in ms */
  getEffectiveSilenceDuration(): number {
    return this.silenceOverride ?? this.maxSilenceDurationMs;
  }

  /**
   * Reset all internal state without firing the callback.
   */
  reset(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.chunks = [];
  }

  /**
   * Destroy the detector and clean up resources.
   */
  destroy(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.chunks = [];
    this.onSpeechEnd = null;
    this.onGapDetected = null;
  }

  /**
   * Flush accumulated chunks if we have enough, firing the callback.
   */
  private flush(): void {
    this.silenceTimer = null;
    if (this.chunks.length >= this.minChunks && this.onSpeechEnd) {
      const collected = this.chunks.slice();
      this.chunks = [];
      this.lastSpeechEndTime = Date.now();
      this.onSpeechEnd(collected);
    } else {
      this.chunks = [];
    }
  }
}


