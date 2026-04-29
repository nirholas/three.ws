// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// Intelligence – Barrel exports
// =============================================================================

export { detectSentiment } from './sentiment'
export { SpeakerIdentifier } from './speaker-id'
export type { SpeakerProfile } from './speaker-id'
export { TopicTracker } from './topic-tracker'
export type { TopicEntry } from './topic-tracker'
export { ContextManager } from './context-manager'
export type { ContextManagerConfig } from './context-manager'
export { PromptBuilder } from './prompt-builder'
export { ConversationStore } from './persistence'
export type { ConversationRecord, SpaceMetadata } from './persistence'


