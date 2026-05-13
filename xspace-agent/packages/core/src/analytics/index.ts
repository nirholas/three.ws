// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§70]

// =============================================================================
// Conversation Intelligence — Main Exports
// =============================================================================

// Pipeline
export {
  scoreSentiment,
  computeSentimentTrend,
  analyzeTopics,
  analyzeSpeakers,
  computeConversationMetrics,
  detectHighlights,
  detectRiskFlags,
  runAnalyticsPipeline,
} from './pipeline'
export type { AnalyticsPipelineResult } from './pipeline'

// Insights
export {
  extractActionItems,
  extractKeyDecisions,
  generateRuleBasedSummary,
  generateRecommendations,
  generateInsights,
} from './insights'

// Real-time
export { RealtimeAnalyticsProcessor } from './realtime'

// Types
export type {
  SentimentScore,
  SentimentPoint,
  SentimentTrend,
  TopicBreakdown,
  SpeakerAnalytics,
  ConversationMetrics,
  ActionItem,
  Highlight,
  RiskFlag,
  SessionInsights,
  TranscriptionMessage,
  AnalyticsPipelineInput,
  LiveAnalyticsState,
  AnalyticsSentimentEvent,
  AnalyticsTopicEvent,
  AnalyticsAlertEvent,
  AnalyticsEvent,
} from './types'


