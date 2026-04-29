// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§71]

// =============================================================================
// Voice Cloning & Custom TTS — Public Exports
// =============================================================================

export { VoiceService } from './service'
export type { VoiceServiceConfig } from './service'
export { VoiceConsentManager } from './consent'
export { createElevenLabsCloningProvider } from './cloning-provider'
export type { VoiceCloningProvider } from './cloning-provider'
export type {
  AudioSample,
  Voice,
  VoiceConsent,
  VoiceCreateConfig,
  VoiceDesignParams,
  VoiceListingConfig,
  VoicePack,
  VoicePackEntry,
  VoicePreview,
  VoiceSettings,
} from './types'


