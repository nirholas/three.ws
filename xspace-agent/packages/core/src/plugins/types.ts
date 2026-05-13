// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Plugin System — Type Definitions
// =============================================================================

import type {
  Message,
  TranscriptionEvent,
  ResponseDecision,
  AgentStatus,
} from '../types'

// ---------------------------------------------------------------------------
// Plugin Interface
// ---------------------------------------------------------------------------

/** Marketplace manifest for published plugins. */
export interface PluginManifest {
  name: string
  version: string
  hooks: string[]
  config?: Record<string, PluginConfigField>
  permissions?: string[]
  entrypoint: string
  minPlatformVersion?: string
}

export interface PluginConfigField {
  type: 'string' | 'number' | 'boolean' | 'string[]'
  default?: unknown
  description?: string
  min?: number
  max?: number
  enum?: string[]
}

export interface Plugin {
  name: string
  version: string
  description?: string
  manifest?: PluginManifest

  // Lifecycle hooks (all optional)
  onInit?(context: PluginContext): Promise<void>
  onJoin?(spaceUrl: string): Promise<void>
  onJoined?(spaceUrl: string): Promise<void>
  onLeave?(): Promise<void>
  onDestroy?(): Promise<void>

  // Audio pipeline hooks
  onAudioCaptured?(audio: AudioFrame): Promise<AudioFrame | null>
  onTranscription?(result: TranscriptionEvent): Promise<TranscriptionEvent | null>
  onBeforeResponse?(input: { messages: Message[]; systemPrompt: string }): Promise<{ messages: Message[]; systemPrompt: string }>
  onResponse?(text: string): Promise<string | null>
  onBeforeSpeak?(audioBuffer: Buffer): Promise<Buffer | null>

  // Conversation hooks
  onSpeakerJoined?(speaker: SpeakerInfo): Promise<void>
  onSpeakerLeft?(speaker: SpeakerInfo): Promise<void>
  onTopicChanged?(topic: string, previousTopic: string): Promise<void>

  // Turn management hooks
  onTurnDecision?(decision: ResponseDecision): Promise<ResponseDecision>

  // Error hooks
  onError?(error: Error, context: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Plugin Context — provided to plugins during onInit
// ---------------------------------------------------------------------------

export interface PluginContext {
  // Read-only access to agent state
  getStatus(): AgentStatus
  getSpaceUrl(): string | null
  getMessages(): Message[]
  getSpeakers(): SpeakerInfo[]
  getMetrics(): Record<string, unknown>

  // Actions the plugin can take
  speak(text: string): Promise<void>
  addMessage(message: Message): void
  log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown): void

  // Event subscription
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
}

// ---------------------------------------------------------------------------
// Supporting Types
// ---------------------------------------------------------------------------

export interface AudioFrame {
  pcm: Float32Array
  sampleRate: number
  timestamp: number
}

export interface SpeakerInfo {
  name: string
  id?: string
  joinedAt: number
}


