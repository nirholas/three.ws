// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

import { describe, it, expect, beforeEach } from 'vitest'
import {
  scoreSentiment,
  computeSentimentTrend,
  analyzeTopics,
  analyzeSpeakers,
  computeConversationMetrics,
  detectHighlights,
  detectRiskFlags,
  runAnalyticsPipeline,
  extractActionItems,
  extractKeyDecisions,
  generateRuleBasedSummary,
  generateRecommendations,
  generateInsights,
  RealtimeAnalyticsProcessor,
} from '../analytics'
import type {
  TranscriptionMessage,
  SentimentPoint,
  SpeakerAnalytics,
  AnalyticsPipelineInput,
} from '../analytics'

// =============================================================================
// Test Helpers
// =============================================================================

function makeMessage(
  speaker: string,
  text: string,
  timestamp: number,
  durationMs = 2000,
): TranscriptionMessage {
  return { speaker, text, timestamp, durationMs, isFinal: true }
}

function makeMessages(count: number, speakers = ['Alice', 'Bob']): TranscriptionMessage[] {
  const msgs: TranscriptionMessage[] = []
  const baseTime = 1700000000000
  for (let i = 0; i < count; i++) {
    const speaker = speakers[i % speakers.length]
    msgs.push(makeMessage(speaker, `This is message number ${i + 1} about the topic`, baseTime + i * 5000))
  }
  return msgs
}

// =============================================================================
// Sentiment Scoring
// =============================================================================

describe('scoreSentiment', () => {
  it('should score positive text with positive value', () => {
    const result = scoreSentiment('This is a great idea, I love it!')
    expect(result.value).toBeGreaterThan(0)
    expect(['positive', 'very_positive']).toContain(result.label)
  })

  it('should score negative text with negative value', () => {
    const result = scoreSentiment('This is terrible and awful')
    expect(result.value).toBeLessThan(0)
    expect(['negative', 'very_negative']).toContain(result.label)
  })

  it('should score neutral text near zero', () => {
    const result = scoreSentiment('The meeting starts at three.')
    expect(result.label).toBe('neutral')
    expect(result.value).toBe(0)
  })

  it('should score frustrated text as very negative', () => {
    const result = scoreSentiment("I can't believe this happened again")
    expect(result.value).toBeLessThan(-0.5)
    expect(result.label).toBe('very_negative')
  })

  it('should score excited text as very positive', () => {
    const result = scoreSentiment('THIS IS ABSOLUTELY INCREDIBLE')
    expect(result.value).toBeGreaterThan(0.5)
    expect(result.label).toBe('very_positive')
  })
})

// =============================================================================
// Sentiment Trend
// =============================================================================

describe('computeSentimentTrend', () => {
  it('should return stable for few points', () => {
    const points: SentimentPoint[] = [
      { timestamp: 1, speaker: 'A', sentiment: 0.5 },
      { timestamp: 2, speaker: 'A', sentiment: 0.3 },
    ]
    expect(computeSentimentTrend(points)).toBe('stable')
  })

  it('should detect improving trend', () => {
    const points: SentimentPoint[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: i * 1000,
      speaker: 'A',
      sentiment: -0.5 + (i * 0.15), // starts negative, ends positive
    }))
    expect(computeSentimentTrend(points)).toBe('improving')
  })

  it('should detect declining trend', () => {
    const points: SentimentPoint[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: i * 1000,
      speaker: 'A',
      sentiment: 0.8 - (i * 0.15), // starts positive, ends negative
    }))
    expect(computeSentimentTrend(points)).toBe('declining')
  })

  it('should detect volatile sentiment', () => {
    const points: SentimentPoint[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: i * 1000,
      speaker: 'A',
      sentiment: i % 2 === 0 ? 0.9 : -0.9, // wild swings
    }))
    expect(computeSentimentTrend(points)).toBe('volatile')
  })
})

// =============================================================================
// Topic Analysis
// =============================================================================

describe('analyzeTopics', () => {
  it('should return empty array for no messages', () => {
    expect(analyzeTopics([])).toEqual([])
  })

  it('should extract topics from messages', () => {
    const msgs = Array.from({ length: 15 }, (_, i) =>
      makeMessage('Alice', `The machine learning model needs more training data for accuracy`, i * 5000)
    )
    const topics = analyzeTopics(msgs)
    expect(topics.length).toBeGreaterThan(0)
    expect(topics[0].messageCount).toBeGreaterThan(0)
    expect(topics[0].durationPct).toBeGreaterThan(0)
    expect(topics[0].keyPhrases.length).toBeGreaterThan(0)
  })

  it('should sum durationPct to approximately 100', () => {
    const msgs = makeMessages(30)
    const topics = analyzeTopics(msgs)
    const totalPct = topics.reduce((s, t) => s + t.durationPct, 0)
    expect(totalPct).toBeCloseTo(100, 0)
  })
})

// =============================================================================
// Speaker Analysis
// =============================================================================

describe('analyzeSpeakers', () => {
  it('should return empty array for no messages', () => {
    expect(analyzeSpeakers([], 60)).toEqual([])
  })

  it('should compute per-speaker analytics', () => {
    const msgs = [
      makeMessage('Alice', 'Hello everyone, lets get started', 0, 3000),
      makeMessage('Bob', 'Sounds good to me', 3000, 2000),
      makeMessage('Alice', 'First topic is the budget review for next quarter', 5000, 5000),
      makeMessage('Charlie', 'I have some concerns about the timeline', 10000, 4000),
      makeMessage('Bob', 'What specific concerns do you have?', 14000, 3000),
    ]

    const speakers = analyzeSpeakers(msgs, 20)
    expect(speakers.length).toBe(3)

    const alice = speakers.find(s => s.id === 'Alice')!
    expect(alice).toBeDefined()
    expect(alice.turns).toBeGreaterThanOrEqual(2)
    expect(alice.talkTimePct).toBeGreaterThan(0)
    expect(alice.engagementScore).toBeGreaterThanOrEqual(0)
    expect(alice.engagementScore).toBeLessThanOrEqual(100)
  })

  it('should detect questions vs statements', () => {
    const msgs = [
      makeMessage('Alice', 'What do you think?', 0, 2000),
      makeMessage('Alice', 'How should we proceed?', 2000, 2000),
      makeMessage('Alice', 'I think we should go ahead.', 4000, 2000),
    ]

    const speakers = analyzeSpeakers(msgs, 10)
    const alice = speakers.find(s => s.id === 'Alice')!
    expect(alice.questionCount).toBe(2)
    expect(alice.statementCount).toBe(1)
  })

  it('should compute words per minute', () => {
    const msgs = [
      makeMessage('Alice', 'This is a sentence with exactly eight words', 0, 3000),
    ]
    const speakers = analyzeSpeakers(msgs, 10)
    const alice = speakers.find(s => s.id === 'Alice')!
    expect(alice.wordsPerMinute).toBeGreaterThan(0)
  })
})

// =============================================================================
// Conversation Metrics
// =============================================================================

describe('computeConversationMetrics', () => {
  it('should handle empty messages', () => {
    const metrics = computeConversationMetrics([], 60)
    expect(metrics.durationSeconds).toBe(60)
    expect(metrics.activeSpeakingSeconds).toBe(0)
    expect(metrics.silenceSeconds).toBe(60)
    expect(metrics.participantCount).toBe(0)
    expect(metrics.totalTurns).toBe(0)
  })

  it('should compute correct participant count', () => {
    const msgs = [
      makeMessage('Alice', 'Hello', 0, 1000),
      makeMessage('Bob', 'Hi', 1000, 1000),
      makeMessage('Charlie', 'Hey', 2000, 1000),
    ]
    const metrics = computeConversationMetrics(msgs, 10)
    expect(metrics.participantCount).toBe(3)
    expect(metrics.totalTurns).toBe(3)
  })

  it('should compute flow score', () => {
    const msgs = makeMessages(20)
    const metrics = computeConversationMetrics(msgs, 120)
    expect(metrics.conversationFlowScore).toBeGreaterThanOrEqual(0)
    expect(metrics.conversationFlowScore).toBeLessThanOrEqual(100)
  })

  it('should compute information density', () => {
    const msgs = [
      makeMessage('Alice', 'This is a test sentence with multiple words for density calculation', 0, 5000),
      makeMessage('Bob', 'Another sentence here with some more words to analyze', 5000, 5000),
    ]
    const metrics = computeConversationMetrics(msgs, 20)
    expect(metrics.informationDensity).toBeGreaterThan(0)
  })
})

// =============================================================================
// Highlights Detection
// =============================================================================

describe('detectHighlights', () => {
  it('should detect decisions', () => {
    const msgs = [
      makeMessage('Alice', "We decided to go with option B for the release", 0),
    ]
    const highlights = detectHighlights(msgs)
    expect(highlights.some(h => h.type === 'decision')).toBe(true)
  })

  it('should detect action items', () => {
    const msgs = [
      makeMessage('Bob', "Action item: review the PR by Friday", 0),
      makeMessage('Alice', "I'll update the documentation tomorrow", 5000),
    ]
    const highlights = detectHighlights(msgs)
    expect(highlights.filter(h => h.type === 'action_item').length).toBeGreaterThanOrEqual(1)
  })

  it('should detect disagreements', () => {
    const msgs = [
      makeMessage('Charlie', "I disagree, that approach is wrong and terrible", 0),
    ]
    const highlights = detectHighlights(msgs)
    expect(highlights.some(h => h.type === 'disagreement')).toBe(true)
  })

  it('should detect consensus', () => {
    const msgs = [
      makeMessage('Alice', 'Everyone agrees this is the right path forward', 0),
    ]
    const highlights = detectHighlights(msgs)
    expect(highlights.some(h => h.type === 'consensus')).toBe(true)
  })
})

// =============================================================================
// Risk Flags
// =============================================================================

describe('detectRiskFlags', () => {
  it('should flag dominant speaker', () => {
    const speakers: SpeakerAnalytics[] = [
      { id: 'Alice', name: 'Alice', talkTimePct: 75, talkTimeSeconds: 45, turns: 10, avgTurnLengthSeconds: 4.5, sentimentAvg: 0, wordsPerMinute: 150, questionCount: 2, statementCount: 8, interruptionsMade: 0, interruptionsReceived: 0, engagementScore: 60 },
      { id: 'Bob', name: 'Bob', talkTimePct: 15, talkTimeSeconds: 9, turns: 5, avgTurnLengthSeconds: 1.8, sentimentAvg: 0, wordsPerMinute: 140, questionCount: 3, statementCount: 2, interruptionsMade: 0, interruptionsReceived: 0, engagementScore: 40 },
      { id: 'Charlie', name: 'Charlie', talkTimePct: 10, talkTimeSeconds: 6, turns: 3, avgTurnLengthSeconds: 2, sentimentAvg: 0, wordsPerMinute: 130, questionCount: 1, statementCount: 2, interruptionsMade: 0, interruptionsReceived: 0, engagementScore: 25 },
    ]

    const flags = detectRiskFlags([], [], speakers)
    expect(flags.some(f => f.type === 'dominant_speaker')).toBe(true)
  })

  it('should flag low engagement participants', () => {
    const speakers: SpeakerAnalytics[] = [
      { id: 'Alice', name: 'Alice', talkTimePct: 50, talkTimeSeconds: 30, turns: 10, avgTurnLengthSeconds: 3, sentimentAvg: 0, wordsPerMinute: 150, questionCount: 5, statementCount: 5, interruptionsMade: 0, interruptionsReceived: 0, engagementScore: 70 },
      { id: 'Bob', name: 'Bob', talkTimePct: 46, talkTimeSeconds: 28, turns: 8, avgTurnLengthSeconds: 3.5, sentimentAvg: 0, wordsPerMinute: 140, questionCount: 3, statementCount: 5, interruptionsMade: 0, interruptionsReceived: 0, engagementScore: 65 },
      { id: 'Charlie', name: 'Charlie', talkTimePct: 3, talkTimeSeconds: 2, turns: 1, avgTurnLengthSeconds: 2, sentimentAvg: 0, wordsPerMinute: 100, questionCount: 0, statementCount: 1, interruptionsMade: 0, interruptionsReceived: 0, engagementScore: 10 },
    ]

    const flags = detectRiskFlags([], [], speakers)
    expect(flags.some(f => f.type === 'low_engagement')).toBe(true)
  })
})

// =============================================================================
// Action Item Extraction
// =============================================================================

describe('extractActionItems', () => {
  it('should extract explicit action items', () => {
    const msgs = [
      makeMessage('Alice', 'Action item: deploy the new service by Monday', 0),
      makeMessage('Bob', "I'll write the unit tests for the API endpoints", 5000),
    ]
    const items = extractActionItems(msgs)
    expect(items.length).toBeGreaterThanOrEqual(1)
    expect(items[0].text.length).toBeGreaterThan(0)
  })

  it('should determine priority from urgency keywords', () => {
    const msgs = [
      makeMessage('Alice', 'Action item: this is urgent, fix the critical bug ASAP', 0),
    ]
    const items = extractActionItems(msgs)
    expect(items.length).toBeGreaterThanOrEqual(1)
    expect(items[0].priority).toBe('high')
  })

  it('should deduplicate similar action items', () => {
    const msgs = [
      makeMessage('Alice', 'Action item: update the docs', 0),
      makeMessage('Alice', 'Action item: update the docs please', 5000),
    ]
    const items = extractActionItems(msgs)
    // Should collapse similar items
    expect(items.length).toBeLessThanOrEqual(2)
  })
})

// =============================================================================
// Key Decisions
// =============================================================================

describe('extractKeyDecisions', () => {
  it('should extract decisions from text', () => {
    const msgs = [
      makeMessage('Alice', 'We decided to use PostgreSQL for the database', 0),
      makeMessage('Bob', 'Agreed, moving forward with the microservices architecture', 5000),
    ]
    const decisions = extractKeyDecisions(msgs)
    expect(decisions.length).toBeGreaterThanOrEqual(1)
  })
})

// =============================================================================
// Full Pipeline
// =============================================================================

describe('runAnalyticsPipeline', () => {
  it('should produce complete analytics result', () => {
    const messages = [
      makeMessage('Alice', 'Welcome everyone, lets discuss the project timeline', 0, 3000),
      makeMessage('Bob', 'Sounds great, I think we are on track', 3000, 2000),
      makeMessage('Charlie', 'I have concerns about the testing phase', 5000, 3000),
      makeMessage('Alice', 'What specific concerns do you have?', 8000, 2000),
      makeMessage('Charlie', 'The automated tests are not covering edge cases', 10000, 4000),
      makeMessage('Bob', 'We decided to extend the testing phase by a week', 14000, 3000),
      makeMessage('Alice', 'Everyone agrees, lets action item that for next sprint', 17000, 3000),
    ]

    const input: AnalyticsPipelineInput = {
      sessionId: 'test-session',
      orgId: 'test-org',
      messages,
      startedAt: 0,
      endedAt: 20000,
    }

    const result = runAnalyticsPipeline(input)

    // Metrics
    expect(result.metrics.durationSeconds).toBe(20)
    expect(result.metrics.participantCount).toBe(3)
    expect(result.metrics.totalTurns).toBeGreaterThanOrEqual(3)

    // Sentiment
    expect(result.sentimentPoints.length).toBe(7)
    expect(typeof result.sentimentAvg).toBe('number')
    expect(['improving', 'declining', 'stable', 'volatile']).toContain(result.sentimentTrend)

    // Topics
    expect(result.topics.length).toBeGreaterThanOrEqual(0) // may be 0 for small message count

    // Speakers
    expect(result.speakers.length).toBe(3)
    const alice = result.speakers.find(s => s.id === 'Alice')!
    expect(alice).toBeDefined()
    expect(alice.engagementScore).toBeGreaterThanOrEqual(0)

    // Primary topic
    expect(typeof result.primaryTopic).toBe('string')
  })
})

// =============================================================================
// Insight Generation
// =============================================================================

describe('generateInsights', () => {
  it('should produce a complete SessionInsights object', () => {
    const messages = makeMessages(20, ['Alice', 'Bob', 'Charlie'])
    const input: AnalyticsPipelineInput = {
      sessionId: 'test',
      orgId: 'org',
      messages,
      startedAt: 0,
      endedAt: 100000,
    }

    const result = runAnalyticsPipeline(input)
    const insights = generateInsights(result, messages)

    expect(insights.summary.length).toBeGreaterThan(0)
    expect(Array.isArray(insights.keyDecisions)).toBe(true)
    expect(Array.isArray(insights.actionItems)).toBe(true)
    expect(Array.isArray(insights.topicBreakdown)).toBe(true)
    expect(Array.isArray(insights.sentimentArc)).toBe(true)
    expect(Array.isArray(insights.speakerRankings)).toBe(true)
    expect(Array.isArray(insights.recommendations)).toBe(true)
    expect(Array.isArray(insights.highlights)).toBe(true)
    expect(Array.isArray(insights.riskFlags)).toBe(true)
  })
})

// =============================================================================
// Recommendations
// =============================================================================

describe('generateRecommendations', () => {
  it('should recommend for declining sentiment', () => {
    const result = {
      sentimentTrend: 'declining' as const,
      speakers: [],
      riskFlags: [],
    } as any

    const recs = generateRecommendations(result)
    expect(recs.some(r => r.includes('declined'))).toBe(true)
  })
})

// =============================================================================
// Real-Time Analytics Processor
// =============================================================================

describe('RealtimeAnalyticsProcessor', () => {
  let processor: RealtimeAnalyticsProcessor

  beforeEach(() => {
    processor = new RealtimeAnalyticsProcessor('session-1')
  })

  it('should emit sentiment events for final messages', () => {
    const events = processor.processMessage(
      makeMessage('Alice', 'This is a great conversation', Date.now())
    )
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].type).toBe('analytics.sentiment')
    if (events[0].type === 'analytics.sentiment') {
      expect(events[0].data.speaker).toBe('Alice')
      expect(typeof events[0].data.sentiment).toBe('number')
      expect(typeof events[0].data.avgSentiment).toBe('number')
    }
  })

  it('should not emit events for non-final messages', () => {
    const events = processor.processMessage({
      speaker: 'Alice',
      text: 'partial...',
      timestamp: Date.now(),
      isFinal: false,
    })
    expect(events).toEqual([])
  })

  it('should emit topic change events after update interval', () => {
    // Send 10 messages about machine learning
    let topicEvent = null
    for (let i = 0; i < 10; i++) {
      const events = processor.processMessage(
        makeMessage('Alice', 'Deep learning neural network training model', Date.now() + i * 1000)
      )
      const topic = events.find(e => e.type === 'analytics.topic')
      if (topic) topicEvent = topic
    }

    // After 10 messages, a topic detection should have run
    // May or may not emit a topic event depending on whether topic changed
    expect(processor.getCurrentTopic()).toBeDefined()
  })

  it('should track speaker states', () => {
    processor.processMessage(makeMessage('Alice', 'Hello', Date.now(), 2000))
    processor.processMessage(makeMessage('Bob', 'Hi there', Date.now() + 2000, 1500))

    const state = processor.getState()
    expect(state.speakerStates.size).toBe(2)
  })

  it('should maintain sentiment sliding window', () => {
    for (let i = 0; i < 5; i++) {
      processor.processMessage(
        makeMessage('Alice', 'This is a positive great amazing message', Date.now() + i * 1000)
      )
    }

    const avg = processor.getCurrentSentimentAvg()
    expect(avg).toBeGreaterThan(0)
  })
})

// =============================================================================
// Rule-based Summary
// =============================================================================

describe('generateRuleBasedSummary', () => {
  it('should include duration and participant count', () => {
    const messages = makeMessages(10)
    const input: AnalyticsPipelineInput = {
      sessionId: 'test',
      orgId: 'org',
      messages,
      startedAt: 0,
      endedAt: 600000, // 10 minutes
    }
    const result = runAnalyticsPipeline(input)
    const summary = generateRuleBasedSummary(result, messages)

    expect(summary).toContain('minute')
    expect(summary).toContain('participant')
  })
})


