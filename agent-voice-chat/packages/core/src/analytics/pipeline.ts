// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§67]

// =============================================================================
// Conversation Intelligence — Analytics Pipeline
// =============================================================================

import { detectSentiment } from '../intelligence/sentiment'
import type {
  AnalyticsPipelineInput,
  TranscriptionMessage,
  SentimentScore,
  SentimentPoint,
  SentimentTrend,
  TopicBreakdown,
  SpeakerAnalytics,
  ConversationMetrics,
  Highlight,
  RiskFlag,
} from './types'

// ---------------------------------------------------------------------------
// Sentiment Scoring
// ---------------------------------------------------------------------------

const SENTIMENT_MAP: Record<string, number> = {
  positive: 0.7,
  excited: 0.9,
  neutral: 0.0,
  question: 0.1,
  negative: -0.7,
  frustrated: -0.9,
}

export function scoreSentiment(text: string): SentimentScore {
  const label = detectSentiment(text)
  const value = SENTIMENT_MAP[label] ?? 0

  if (value >= 0.5) return { value, label: 'very_positive' }
  if (value > 0) return { value, label: 'positive' }
  if (value === 0) return { value, label: 'neutral' }
  if (value > -0.5) return { value, label: 'negative' }
  return { value, label: 'very_negative' }
}

export function computeSentimentTrend(points: SentimentPoint[]): SentimentTrend {
  if (points.length < 4) return 'stable'

  const half = Math.floor(points.length / 2)
  const firstHalf = points.slice(0, half)
  const secondHalf = points.slice(half)

  const avgFirst = firstHalf.reduce((s, p) => s + p.sentiment, 0) / firstHalf.length
  const avgSecond = secondHalf.reduce((s, p) => s + p.sentiment, 0) / secondHalf.length

  // Check for volatility (high standard deviation)
  const allValues = points.map(p => p.sentiment)
  const mean = allValues.reduce((s, v) => s + v, 0) / allValues.length
  const variance = allValues.reduce((s, v) => s + (v - mean) ** 2, 0) / allValues.length
  const stddev = Math.sqrt(variance)

  if (stddev > 0.5) return 'volatile'

  const diff = avgSecond - avgFirst
  if (diff > 0.15) return 'improving'
  if (diff < -0.15) return 'declining'
  return 'stable'
}

// ---------------------------------------------------------------------------
// Topic Analysis
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'can', 'shall', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'that', 'this', 'with', 'for', 'from', 'but', 'not', 'what', 'about', 'just',
  'like', 'think', 'know', 'yeah', 'okay', 'right', 'well', 'so', 'um', 'uh',
  'also', 'then', 'than', 'more', 'very', 'really', 'been', 'being', 'some',
  'there', 'here', 'when', 'where', 'which', 'while', 'into', 'only', 'over',
  'such', 'after', 'before', 'between', 'each', 'through', 'your', 'our',
  'their', 'said', 'going', 'want', 'come', 'make', 'much', 'even',
  'mean', 'actually', 'thing', 'things', 'people', 'kind',
])

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w))
}

export function analyzeTopics(messages: TranscriptionMessage[]): TopicBreakdown[] {
  if (messages.length === 0) return []

  // Segment messages into topic windows (every 10 messages)
  const windowSize = 10
  const windows: TranscriptionMessage[][] = []
  for (let i = 0; i < messages.length; i += windowSize) {
    windows.push(messages.slice(i, i + windowSize))
  }

  const topicMap = new Map<string, {
    messageCount: number
    sentimentSum: number
    keyPhrases: Map<string, number>
    firstTimestamp: number
    lastTimestamp: number
  }>()

  for (const window of windows) {
    const combinedText = window.map(m => m.text).join(' ')
    const keywords = extractKeywords(combinedText)

    // Frequency count
    const freq = new Map<string, number>()
    for (const kw of keywords) {
      freq.set(kw, (freq.get(kw) || 0) + 1)
    }

    // Top 3 keywords form the topic
    const topKeywords = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word)

    const topic = topKeywords.length > 0 ? topKeywords.join(', ') : 'general'

    const existing = topicMap.get(topic) || {
      messageCount: 0,
      sentimentSum: 0,
      keyPhrases: new Map(),
      firstTimestamp: window[0].timestamp,
      lastTimestamp: window[window.length - 1].timestamp,
    }

    existing.messageCount += window.length
    existing.lastTimestamp = window[window.length - 1].timestamp

    for (const msg of window) {
      existing.sentimentSum += scoreSentiment(msg.text).value
    }

    for (const [kw, count] of freq.entries()) {
      existing.keyPhrases.set(kw, (existing.keyPhrases.get(kw) || 0) + count)
    }

    topicMap.set(topic, existing)
  }

  const totalMessages = messages.length

  return [...topicMap.entries()]
    .map(([topic, data]) => ({
      topic,
      durationPct: (data.messageCount / totalMessages) * 100,
      sentimentAvg: data.messageCount > 0 ? data.sentimentSum / data.messageCount : 0,
      keyPhrases: [...data.keyPhrases.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([phrase]) => phrase),
      messageCount: data.messageCount,
    }))
    .sort((a, b) => b.durationPct - a.durationPct)
}

// ---------------------------------------------------------------------------
// Speaker Analysis
// ---------------------------------------------------------------------------

export function analyzeSpeakers(messages: TranscriptionMessage[], totalDurationSeconds: number): SpeakerAnalytics[] {
  const speakerMap = new Map<string, {
    talkTimeMs: number
    turns: number
    turnLengths: number[]
    wordCount: number
    sentimentSum: number
    questionCount: number
    statementCount: number
    interruptionsMade: number
    interruptionsReceived: number
    messageCount: number
  }>()

  let prevSpeaker: string | null = null
  let prevEnd = 0

  for (const msg of messages) {
    const speaker = msg.speaker || 'unknown'
    const existing = speakerMap.get(speaker) || {
      talkTimeMs: 0,
      turns: 0,
      turnLengths: [],
      wordCount: 0,
      sentimentSum: 0,
      questionCount: 0,
      statementCount: 0,
      interruptionsMade: 0,
      interruptionsReceived: 0,
      messageCount: 0,
    }

    const duration = msg.durationMs || estimateDurationMs(msg.text)
    existing.talkTimeMs += duration
    existing.wordCount += msg.text.split(/\s+/).length
    existing.sentimentSum += scoreSentiment(msg.text).value
    existing.messageCount++

    // Turn counting (new turn if different speaker)
    if (speaker !== prevSpeaker) {
      existing.turns++
      if (existing.turnLengths.length > 0 || prevSpeaker !== null) {
        existing.turnLengths.push(duration)
      }

      // Interruption detection: if previous message ended less than 200ms ago
      if (prevSpeaker && prevEnd > 0 && (msg.timestamp - prevEnd) < 200) {
        existing.interruptionsMade++
        const prevData = speakerMap.get(prevSpeaker)
        if (prevData) prevData.interruptionsReceived++
      }
    } else {
      // Same speaker continuing — extend last turn
      const lastIdx = existing.turnLengths.length - 1
      if (lastIdx >= 0) existing.turnLengths[lastIdx] += duration
    }

    // Question vs statement
    if (msg.text.includes('?')) {
      existing.questionCount++
    } else {
      existing.statementCount++
    }

    speakerMap.set(speaker, existing)
    prevSpeaker = speaker
    prevEnd = msg.timestamp + duration
  }

  const totalMs = totalDurationSeconds * 1000

  return [...speakerMap.entries()].map(([id, data]) => {
    const talkTimeSeconds = data.talkTimeMs / 1000
    const talkMinutes = talkTimeSeconds / 60

    const engagementScore = computeEngagementScore({
      talkTimePct: totalMs > 0 ? (data.talkTimeMs / totalMs) * 100 : 0,
      turnCount: data.turns,
      questionRatio: data.messageCount > 0 ? data.questionCount / data.messageCount : 0,
      sentimentVariance: Math.abs(data.messageCount > 0 ? data.sentimentSum / data.messageCount : 0),
      interruptionsMade: data.interruptionsMade,
    })

    return {
      id,
      name: id,
      talkTimePct: totalMs > 0 ? (data.talkTimeMs / totalMs) * 100 : 0,
      talkTimeSeconds,
      turns: data.turns,
      avgTurnLengthSeconds: data.turns > 0
        ? data.turnLengths.reduce((s, v) => s + v, 0) / data.turns / 1000
        : 0,
      sentimentAvg: data.messageCount > 0 ? data.sentimentSum / data.messageCount : 0,
      wordsPerMinute: talkMinutes > 0 ? data.wordCount / talkMinutes : 0,
      questionCount: data.questionCount,
      statementCount: data.statementCount,
      interruptionsMade: data.interruptionsMade,
      interruptionsReceived: data.interruptionsReceived,
      engagementScore,
    }
  }).sort((a, b) => b.talkTimePct - a.talkTimePct)
}

function estimateDurationMs(text: string): number {
  // Rough estimate: ~150 words per minute
  const words = text.split(/\s+/).length
  return (words / 150) * 60 * 1000
}

function computeEngagementScore(input: {
  talkTimePct: number
  turnCount: number
  questionRatio: number
  sentimentVariance: number
  interruptionsMade: number
}): number {
  // Weighted composite 0–100
  const talkScore = Math.min(input.talkTimePct * 2, 30) // max 30 points
  const turnScore = Math.min(input.turnCount * 2, 25)     // max 25 points
  const questionScore = input.questionRatio * 20           // max 20 points
  const sentimentScore = (1 - input.sentimentVariance) * 15 // max 15 points (neutral is high engagement)
  const interactionScore = Math.min(input.interruptionsMade * 5, 10) // max 10 points

  return Math.round(Math.max(0, Math.min(100,
    talkScore + turnScore + questionScore + sentimentScore + interactionScore
  )))
}

// ---------------------------------------------------------------------------
// Conversation Metrics
// ---------------------------------------------------------------------------

export function computeConversationMetrics(
  messages: TranscriptionMessage[],
  totalDurationSeconds: number,
): ConversationMetrics {
  if (messages.length === 0) {
    return {
      durationSeconds: totalDurationSeconds,
      activeSpeakingSeconds: 0,
      silenceSeconds: totalDurationSeconds,
      participantCount: 0,
      totalTurns: 0,
      avgTurnLengthSeconds: 0,
      conversationFlowScore: 0,
      informationDensity: 0,
    }
  }

  const speakers = new Set(messages.map(m => m.speaker))
  let activeSpeakingMs = 0
  let turnCount = 0
  let prevSpeaker: string | null = null
  let gaps: number[] = []
  let prevEnd = 0

  for (const msg of messages) {
    const duration = msg.durationMs || estimateDurationMs(msg.text)
    activeSpeakingMs += duration

    if (msg.speaker !== prevSpeaker) {
      turnCount++
    }

    // Track gaps between messages for flow scoring
    if (prevEnd > 0) {
      const gap = msg.timestamp - prevEnd
      if (gap > 0) gaps.push(gap)
    }

    prevSpeaker = msg.speaker
    prevEnd = msg.timestamp + duration
  }

  const activeSpeakingSeconds = activeSpeakingMs / 1000
  const silenceSeconds = Math.max(0, totalDurationSeconds - activeSpeakingSeconds)

  // Flow score: penalize long gaps and very short gaps (interruptions)
  let flowScore = 80
  if (gaps.length > 0) {
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length
    if (avgGap > 5000) flowScore -= 20  // too many long pauses
    if (avgGap < 200) flowScore -= 15   // too many interruptions

    const longGaps = gaps.filter(g => g > 10000).length
    flowScore -= longGaps * 5

    flowScore = Math.max(0, Math.min(100, flowScore))
  }

  // Information density: words per minute of active speaking
  const totalWords = messages.reduce((s, m) => s + m.text.split(/\s+/).length, 0)
  const activeMinutes = activeSpeakingSeconds / 60
  const informationDensity = activeMinutes > 0 ? totalWords / activeMinutes : 0

  return {
    durationSeconds: totalDurationSeconds,
    activeSpeakingSeconds: Math.round(activeSpeakingSeconds),
    silenceSeconds: Math.round(silenceSeconds),
    participantCount: speakers.size,
    totalTurns: turnCount,
    avgTurnLengthSeconds: turnCount > 0 ? activeSpeakingSeconds / turnCount : 0,
    conversationFlowScore: Math.round(flowScore),
    informationDensity: Math.round(informationDensity),
  }
}

// ---------------------------------------------------------------------------
// Highlight & Risk Detection
// ---------------------------------------------------------------------------

export function detectHighlights(messages: TranscriptionMessage[]): Highlight[] {
  const highlights: Highlight[] = []

  for (const msg of messages) {
    const sentiment = scoreSentiment(msg.text)
    const lower = msg.text.toLowerCase()

    // Decision detection
    if (/\b(decided|agreed|let's go with|we'll do|final decision|moving forward with)\b/i.test(msg.text)) {
      highlights.push({
        timestamp: msg.timestamp,
        type: 'decision',
        speaker: msg.speaker,
        text: msg.text,
        sentiment: sentiment.value,
      })
    }

    // Action item language
    if (/\b(action item|todo|follow up|i'll|we need to|next step|deadline)\b/i.test(msg.text)) {
      highlights.push({
        timestamp: msg.timestamp,
        type: 'action_item',
        speaker: msg.speaker,
        text: msg.text,
        sentiment: sentiment.value,
      })
    }

    // Strong disagreement
    if (sentiment.value < -0.5 && /\b(disagree|wrong|no way|absolutely not|that's not)\b/i.test(msg.text)) {
      highlights.push({
        timestamp: msg.timestamp,
        type: 'disagreement',
        speaker: msg.speaker,
        text: msg.text,
        sentiment: sentiment.value,
      })
    }

    // Consensus
    if (/\b(everyone agrees|all agreed|consensus|unanimously|we all think)\b/i.test(msg.text)) {
      highlights.push({
        timestamp: msg.timestamp,
        type: 'consensus',
        speaker: msg.speaker,
        text: msg.text,
        sentiment: sentiment.value,
      })
    }
  }

  return highlights
}

export function detectRiskFlags(
  messages: TranscriptionMessage[],
  sentimentPoints: SentimentPoint[],
  speakers: SpeakerAnalytics[],
): RiskFlag[] {
  const flags: RiskFlag[] = []

  // Negative sentiment spike: >30% negative in a 5-minute window
  if (sentimentPoints.length >= 5) {
    const windowMs = 5 * 60 * 1000
    for (let i = 0; i < sentimentPoints.length; i++) {
      const windowStart = sentimentPoints[i].timestamp
      const windowPoints = sentimentPoints.filter(
        p => p.timestamp >= windowStart && p.timestamp < windowStart + windowMs
      )
      if (windowPoints.length >= 3) {
        const negativeRatio = windowPoints.filter(p => p.sentiment < -0.3).length / windowPoints.length
        if (negativeRatio > 0.3) {
          flags.push({
            type: 'negative_sentiment_spike',
            severity: negativeRatio > 0.6 ? 'high' : 'medium',
            description: `${Math.round(negativeRatio * 100)}% negative sentiment detected in 5-minute window`,
            timestamp: windowStart,
          })
          break // One alert per session
        }
      }
    }
  }

  // Dominant speaker: one person >60% of talk time
  for (const speaker of speakers) {
    if (speaker.talkTimePct > 60 && speakers.length > 2) {
      flags.push({
        type: 'dominant_speaker',
        severity: speaker.talkTimePct > 80 ? 'high' : 'medium',
        description: `${speaker.name} dominated ${Math.round(speaker.talkTimePct)}% of conversation time`,
      })
    }
  }

  // Low engagement: speaker with < 5% talk time in multi-speaker session
  if (speakers.length >= 3) {
    const lowEngagement = speakers.filter(s => s.talkTimePct < 5 && s.turns >= 1)
    if (lowEngagement.length > 0) {
      flags.push({
        type: 'low_engagement',
        severity: 'low',
        description: `${lowEngagement.length} participant(s) with minimal engagement (<5% talk time)`,
      })
    }
  }

  return flags
}

// ---------------------------------------------------------------------------
// Full Pipeline Execution
// ---------------------------------------------------------------------------

export interface AnalyticsPipelineResult {
  metrics: ConversationMetrics
  sentimentPoints: SentimentPoint[]
  sentimentTrend: SentimentTrend
  topics: TopicBreakdown[]
  speakers: SpeakerAnalytics[]
  highlights: Highlight[]
  riskFlags: RiskFlag[]
  primaryTopic: string
  sentimentAvg: number
  sentimentMin: number
  sentimentMax: number
}

export function runAnalyticsPipeline(input: AnalyticsPipelineInput): AnalyticsPipelineResult {
  const totalDurationSeconds = (input.endedAt - input.startedAt) / 1000

  // Sentiment points for every message
  const sentimentPoints: SentimentPoint[] = input.messages
    .filter(m => m.isFinal)
    .map(msg => ({
      timestamp: msg.timestamp,
      speaker: msg.speaker,
      sentiment: scoreSentiment(msg.text).value,
    }))

  const sentimentValues = sentimentPoints.map(p => p.sentiment)
  const sentimentAvg = sentimentValues.length > 0
    ? sentimentValues.reduce((s, v) => s + v, 0) / sentimentValues.length : 0
  const sentimentMin = sentimentValues.length > 0 ? Math.min(...sentimentValues) : 0
  const sentimentMax = sentimentValues.length > 0 ? Math.max(...sentimentValues) : 0
  const sentimentTrend = computeSentimentTrend(sentimentPoints)

  const finalMessages = input.messages.filter(m => m.isFinal)
  const metrics = computeConversationMetrics(finalMessages, totalDurationSeconds)
  const topics = analyzeTopics(finalMessages)
  const speakers = analyzeSpeakers(finalMessages, totalDurationSeconds)
  const highlights = detectHighlights(finalMessages)
  const riskFlags = detectRiskFlags(finalMessages, sentimentPoints, speakers)

  const primaryTopic = topics.length > 0 ? topics[0].topic : 'general'

  // Attach topics to sentiment points
  for (const point of sentimentPoints) {
    point.topic = primaryTopic
  }

  return {
    metrics,
    sentimentPoints,
    sentimentTrend,
    topics,
    speakers,
    highlights,
    riskFlags,
    primaryTopic,
    sentimentAvg,
    sentimentMin,
    sentimentMax,
  }
}


