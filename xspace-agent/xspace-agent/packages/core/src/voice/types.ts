// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

// =============================================================================
// Voice Cloning & Custom TTS — Types
// =============================================================================

/**
 * Configuration for creating a custom voice.
 */
export interface VoiceCreateConfig {
  name: string
  description: string
  language: string
  gender: 'male' | 'female' | 'neutral'
  age: 'young' | 'middle' | 'senior'
  style: 'conversational' | 'professional' | 'energetic' | 'calm' | 'authoritative'
  sampleRate: 22050 | 44100
}

/**
 * An audio sample used for voice cloning.
 */
export interface AudioSample {
  audioBuffer: Buffer
  format: 'wav' | 'mp3'
  durationSeconds: number
  /** Transcript of the spoken content in the sample. */
  transcript: string
}

/**
 * Voice cloning settings that control output quality.
 */
export interface VoiceSettings {
  /** Stability: higher = more consistent output (0–1). */
  stability: number
  /** Similarity boost: higher = closer to original sample (0–1). */
  similarityBoost: number
  /** Style exaggeration: higher = more expressive (0–1). */
  style: number
  /** Speech speed multiplier (0.5–2.0). */
  speed: number
}

/**
 * A custom or library voice.
 */
export interface Voice {
  id: string
  orgId: string
  name: string
  description: string
  language: string
  gender: 'male' | 'female' | 'neutral'
  age: 'young' | 'middle' | 'senior'
  style: 'conversational' | 'professional' | 'energetic' | 'calm' | 'authoritative'
  /** The upstream provider voice ID (e.g. ElevenLabs voice_id). */
  providerVoiceId: string
  /** Which cloning provider created this voice. */
  provider: 'elevenlabs' | 'coqui'
  /** How this voice was created. */
  source: 'cloned' | 'designed' | 'library'
  settings: VoiceSettings
  /** Whether the voice is available in the marketplace. */
  published: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Consent record for voice cloning (safety & compliance).
 */
export interface VoiceConsent {
  voiceId: string
  consentType: 'self' | 'authorized' | 'synthetic'
  /** Path or identifier for uploaded consent document. */
  consentDocument?: string
  agreedToTerms: boolean
  ipAddress: string
  timestamp: string
}

/**
 * Configuration for publishing a voice to the marketplace.
 */
export interface VoiceListingConfig {
  title: string
  description: string
  tags: string[]
  /** Price in USD per month. */
  pricePerMonth: number
  /** Preview text for generating a sample. */
  previewText: string
}

/**
 * A pre-built voice pack in the library.
 */
export interface VoicePack {
  id: string
  name: string
  description: string
  voices: VoicePackEntry[]
  pricePerMonth: number
}

/**
 * An individual voice within a voice pack.
 */
export interface VoicePackEntry {
  voiceId: string
  name: string
  description: string
  previewUrl?: string
}

/**
 * Result of a voice preview request.
 */
export interface VoicePreview {
  audioBuffer: Buffer
  durationSeconds: number
  format: 'mp3'
}

/**
 * Parameters for designing a voice from a text description (no samples needed).
 */
export interface VoiceDesignParams {
  description: string
  gender: 'male' | 'female' | 'neutral'
  age: 'young' | 'middle' | 'senior'
  accent?: string
  style: 'conversational' | 'professional' | 'energetic' | 'calm' | 'authoritative'
}


