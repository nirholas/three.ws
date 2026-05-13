// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§76]

// =============================================================================
// Audio Pipeline Types
// =============================================================================

/** WebRTC connection quality statistics. */
export interface WebRTCStats {
  packetsLost: number;
  jitter: number;        // seconds
  roundTripTime: number; // seconds
  bytesReceived: number;
  audioLevel?: number;
}

/** Real-time audio level information. */
export interface AudioLevels {
  inbound: number;
  outbound: number;
  peak: number;
}

/** Events emitted by the audio pipeline for observability. */
export interface AudioPipelineEvents {
  'audio:level': (data: AudioLevels) => void;
  'audio:webrtc-stats': (data: WebRTCStats) => void;
  'audio:injection-start': (data: { durationMs: number }) => void;
  'audio:injection-end': () => void;
  'audio:echo-detected': (data: { energy: number }) => void;
  'audio:vad-speech': (data: { energy: number }) => void;
  'audio:vad-silence': (data: { durationMs: number }) => void;
  'audio:capture-started': () => void;
  'audio:capture-stopped': () => void;
  'audio:quality-degraded': (data: { reason: string; stats: WebRTCStats }) => void;
}

/** Configuration for the echo canceller. */
export interface EchoCancellerConfig {
  /** Energy ratio threshold — captured frame energy must exceed injection energy by this factor (default: 1.5) */
  energyRatio?: number;
  /** High-pass filter cutoff in Hz to remove low-frequency echo components (default: 300) */
  highPassCutoffHz?: number;
}

/** Configuration for the gain normalizer. */
export interface GainNormalizerConfig {
  /** Target RMS level for output (default: 0.1) */
  targetRMS?: number;
  /** EMA smoothing factor for gain changes — higher means smoother (default: 0.95) */
  smoothingFactor?: number;
  /** Maximum gain multiplier to prevent distortion (default: 5.0) */
  maxGain?: number;
}

/** Configuration for the WebRTC monitor. */
export interface WebRTCMonitorConfig {
  /** Polling interval in ms for getStats() (default: 5000) */
  pollIntervalMs?: number;
  /** Packet loss threshold that triggers quality-degraded event */
  packetLossThreshold?: number;
  /** Jitter threshold in seconds that triggers quality-degraded event */
  jitterThreshold?: number;
}


