// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Conversation Intelligence — Types
// =============================================================================

// ---------------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------------

export interface SentimentScore {
  value: number       // -1 to +1
  label: 'very_negative' | 'negative' | 'neutral' | 'positive' | 'very_positive'
}

export interface SentimentPoint {
  timestamp: number
  speaker: string
  sentiment: number
  topic?: string
}

export type SentimentTrend = 'improving' | 'declining' | 'stable' | 'volatile'

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export interface TopicBreakdown {
  topic: string
  durationPct: number
  sentimentAvg: number
  keyPhrases: string[]
  messageCount: number
}

// ---------------------------------------------------------------------------
// Speakers
// ---------------------------------------------------------------------------

export interface SpeakerAnalytics {
  id: string
  name: string
  talkTimePct: number
  talkTimeSeconds: number
  turns: number
  avgTurnLengthSeconds: number
  sentimentAvg: number
  wordsPerMinute: number
  questionCount: number
  statementCount: number
  interruptionsMade: number
  interruptionsReceived: number
  engagementScore: number   // 0–100 composite
}

// ---------------------------------------------------------------------------
// Conversation Metrics
// ---------------------------------------------------------------------------

export interface ConversationMetrics {
  durationSeconds: number
  activeSpeakingSeconds: number
  silenceSeconds: number
  participantCount: number
  totalTurns: number
  avgTurnLengthSeconds: number
  conversationFlowScore: number   // 0–100
  informationDensity: number      // tokens per minute
}

// ---------------------------------------------------------------------------
// Action Items & Highlights
// ---------------------------------------------------------------------------

export interface ActionItem {
  text: string
  assignee?: string
  priority: 'low' | 'medium' | 'high'
  dueDate?: string
}

export interface Highlight {
  timestamp: number
  type: 'decision' | 'question' | 'insight' | 'action_item' | 'disagreement' | 'consensus'
  speaker: string
  text: string
  sentiment: number
}

export interface RiskFlag {
  type: 'negative_sentiment_spike' | 'off_topic_drift' | 'low_engagement' | 'unresolved_conflict' | 'dominant_speaker'
  severity: 'low' | 'medium' | 'high'
  description: string
  timestamp?: number
}

// ---------------------------------------------------------------------------
// Session Insights (AI-generated post-session)
// ---------------------------------------------------------------------------

export interface SessionInsights {
  summary: string
  keyDecisions: string[]
  actionItems: ActionItem[]
  topicBreakdown: TopicBreakdown[]
  sentimentArc: SentimentPoint[]
  speakerRankings: SpeakerAnalytics[]
  recommendations: string[]
  highlights: Highlight[]
  riskFlags: RiskFlag[]
}

// ---------------------------------------------------------------------------
// Analytics Pipeline Input
// ---------------------------------------------------------------------------

export interface TranscriptionMessage {
  speaker: string
  text: string
  timestamp: number
  durationMs?: number
  isFinal: boolean
}

export interface AnalyticsPipelineInput {
  sessionId: string
  orgId: string
  messages: TranscriptionMessage[]
  startedAt: number
  endedAt: number
}

// ---------------------------------------------------------------------------
// Real-time Analytics State
// ---------------------------------------------------------------------------

export interface LiveAnalyticsState {
  sessionId: string
  sentimentWindow: SentimentPoint[]
  currentTopic: string
  speakerStates: Map<string, {
    talkTimeMs: number
    turns: number
    lastSentiment: number
    sentimentSum: number
    sentimentCount: number
  }>
  alertsSent: Set<string>
}

// ---------------------------------------------------------------------------
// Analytics Events (emitted via event stream)
// ---------------------------------------------------------------------------

export interface AnalyticsSentimentEvent {
  type: 'analytics.sentiment'
  data: {
    sessionId: string
    speaker: string
    sentiment: number
    avgSentiment: number
    trend: SentimentTrend
  }
}

export interface AnalyticsTopicEvent {
  type: 'analytics.topic'
  data: {
    sessionId: string
    topic: string
    previousTopic: string
    keyPhrases: string[]
  }
}

export interface AnalyticsAlertEvent {
  type: 'analytics.alert'
  data: {
    sessionId: string
    alertType: RiskFlag['type']
    severity: RiskFlag['severity']
    description: string
  }
}

export type AnalyticsEvent =
  | AnalyticsSentimentEvent
  | AnalyticsTopicEvent
  | AnalyticsAlertEvent


