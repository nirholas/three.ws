// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// =============================================================================
// Event Streaming — Barrel export
// =============================================================================

export type {
  StreamEvent,
  TranscriptionChunkEvent,
  ResponseThinkingEvent,
  ResponseGeneratedEvent,
  ResponseSpokenEvent,
  SessionMetricsEvent,
  AgentStateChangeEvent,
  AgentErrorEvent,
  TeamTurnChangeEvent,
  TeamHandoffEvent,
  UsageThresholdEvent,
  SystemAnnouncementEvent,
  EventEnvelope,
  EventFilter,
  ConnectionLimits,
  Subscription,
} from './types'
export { DEFAULT_CONNECTION_LIMITS } from './types'

export { EventPublisher } from './publisher'
export { EventSubscriber, matchGlob, matchesFilter } from './subscriber'
export { EventBuffer } from './buffer'
export { ConnectionManager } from './connection-manager'


