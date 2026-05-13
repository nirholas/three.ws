// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Event Streaming — Types & Interfaces
// =============================================================================

// ---------------------------------------------------------------------------
// Stream Event Types
// ---------------------------------------------------------------------------

export interface TranscriptionChunkEvent {
  type: 'transcription.chunk'
  data: {
    sessionId: string
    speaker: string
    text: string
    timestamp: number
    isFinal: boolean
  }
}

export interface ResponseThinkingEvent {
  type: 'response.thinking'
  data: {
    sessionId: string
    agentId: string
  }
}

export interface ResponseGeneratedEvent {
  type: 'response.generated'
  data: {
    sessionId: string
    agentId: string
    text: string
    tokens: number
    latencyMs: number
  }
}

export interface ResponseSpokenEvent {
  type: 'response.spoken'
  data: {
    sessionId: string
    agentId: string
    durationMs: number
  }
}

export interface SessionMetricsEvent {
  type: 'session.metrics'
  data: {
    sessionId: string
    activeSpeakers: number
    sentiment: number
    topicShift: boolean
  }
}

export interface AgentStateChangeEvent {
  type: 'agent.state_change'
  data: {
    agentId: string
    from: string
    to: string
  }
}

export interface AgentErrorEvent {
  type: 'agent.error'
  data: {
    agentId: string
    error: string
    recoverable: boolean
  }
}

export interface TeamTurnChangeEvent {
  type: 'team.turn_change'
  data: {
    teamId: string
    fromAgent: string
    toAgent: string
    reason: string
  }
}

export interface TeamHandoffEvent {
  type: 'team.handoff'
  data: {
    teamId: string
    fromAgent: string
    toAgent: string
  }
}

export interface UsageThresholdEvent {
  type: 'usage.threshold'
  data: {
    metric: string
    percentage: number
  }
}

export interface SystemAnnouncementEvent {
  type: 'system.announcement'
  data: {
    message: string
    severity: 'info' | 'warning' | 'critical'
  }
}

export type StreamEvent =
  | TranscriptionChunkEvent
  | ResponseThinkingEvent
  | ResponseGeneratedEvent
  | ResponseSpokenEvent
  | SessionMetricsEvent
  | AgentStateChangeEvent
  | AgentErrorEvent
  | TeamTurnChangeEvent
  | TeamHandoffEvent
  | UsageThresholdEvent
  | SystemAnnouncementEvent

// ---------------------------------------------------------------------------
// Envelope — wraps a StreamEvent with metadata for delivery
// ---------------------------------------------------------------------------

export interface EventEnvelope {
  /** Unique event ID for replay / deduplication. */
  id: string
  /** ISO-8601 timestamp of when the event was published. */
  timestamp: string
  /** The org that owns this event (tenant isolation). */
  orgId: string
  /** The wrapped event. */
  event: StreamEvent
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface EventFilter {
  /** Glob patterns for event types, e.g. ['transcription.*', 'response.generated']. */
  events?: string[]
  /** Filter to specific session IDs. */
  sessions?: string[]
  /** Filter to specific agent IDs. */
  agents?: string[]
}

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

export interface ConnectionLimits {
  /** Max concurrent SSE connections per org. */
  maxSSEPerOrg: number
  /** Max concurrent WebSocket connections per org. */
  maxWSPerOrg: number
  /** Heartbeat interval in ms. */
  heartbeatIntervalMs: number
  /** SSE retry hint in ms (sent to client). */
  sseRetryMs: number
  /** Max events buffered per session for replay. */
  maxBufferedEventsPerSession: number
}

export const DEFAULT_CONNECTION_LIMITS: ConnectionLimits = {
  maxSSEPerOrg: 100,
  maxWSPerOrg: 50,
  heartbeatIntervalMs: 30_000,
  sseRetryMs: 3_000,
  maxBufferedEventsPerSession: 100,
}

// ---------------------------------------------------------------------------
// Subscription handle
// ---------------------------------------------------------------------------

export interface Subscription {
  id: string
  orgId: string
  filters: EventFilter
  unsubscribe(): void
}


