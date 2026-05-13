// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Conversation Intelligence — Real-Time Analytics Processor
// =============================================================================
//
// Processes transcription events in real-time during live sessions.
// Maintains sliding-window sentiment, detects topic shifts, and emits
// analytics events via the event streaming system.
// =============================================================================

import { scoreSentiment, computeSentimentTrend } from './pipeline'
import type {
  TranscriptionMessage,
  SentimentPoint,
  SentimentTrend,
  LiveAnalyticsState,
  AnalyticsSentimentEvent,
  AnalyticsTopicEvent,
  AnalyticsAlertEvent,
  AnalyticsEvent,
} from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SENTIMENT_WINDOW_SIZE = 50
const TOPIC_UPDATE_INTERVAL = 10
const NEGATIVE_SPIKE_THRESHOLD = 0.3
const NEGATIVE_SPIKE_WINDOW = 5 * 60 * 1000 // 5 minutes

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'that', 'this', 'with', 'for',
  'from', 'but', 'not', 'what', 'about', 'just', 'like', 'think', 'know',
  'yeah', 'okay', 'right', 'well', 'so', 'um', 'uh',
])

// ---------------------------------------------------------------------------
// Real-Time Analytics Processor
// ---------------------------------------------------------------------------

export class RealtimeAnalyticsProcessor {
  private state: LiveAnalyticsState
  private messageCount = 0
  private messageBuffer: string[] = []

  constructor(sessionId: string) {
    this.state = {
      sessionId,
      sentimentWindow: [],
      currentTopic: 'general',
      speakerStates: new Map(),
      alertsSent: new Set(),
    }
  }

  /**
   * Process a single transcription message and return any analytics events to emit.
   */
  processMessage(msg: TranscriptionMessage): AnalyticsEvent[] {
    if (!msg.isFinal) return []

    const events: AnalyticsEvent[] = []
    this.messageCount++

    // Score sentiment
    const sentiment = scoreSentiment(msg.text)
    const point: SentimentPoint = {
      timestamp: msg.timestamp,
      speaker: msg.speaker,
      sentiment: sentiment.value,
    }

    // Update sliding window
    this.state.sentimentWindow.push(point)
    if (this.state.sentimentWindow.length > SENTIMENT_WINDOW_SIZE) {
      this.state.sentimentWindow.shift()
    }

    // Update speaker state
    const speakerState = this.state.speakerStates.get(msg.speaker) || {
      talkTimeMs: 0,
      turns: 0,
      lastSentiment: 0,
      sentimentSum: 0,
      sentimentCount: 0,
    }
    speakerState.talkTimeMs += msg.durationMs || 0
    speakerState.turns++
    speakerState.lastSentiment = sentiment.value
    speakerState.sentimentSum += sentiment.value
    speakerState.sentimentCount++
    this.state.speakerStates.set(msg.speaker, speakerState)

    // Emit sentiment event
    const avgSentiment = this.state.sentimentWindow.length > 0
      ? this.state.sentimentWindow.reduce((s, p) => s + p.sentiment, 0) / this.state.sentimentWindow.length
      : 0
    const trend = computeSentimentTrend(this.state.sentimentWindow)

    events.push({
      type: 'analytics.sentiment',
      data: {
        sessionId: this.state.sessionId,
        speaker: msg.speaker,
        sentiment: sentiment.value,
        avgSentiment,
        trend,
      },
    })

    // Topic detection every N messages
    this.messageBuffer.push(msg.text)
    if (this.messageCount % TOPIC_UPDATE_INTERVAL === 0) {
      const newTopic = this.detectTopic()
      if (newTopic !== this.state.currentTopic) {
        events.push({
          type: 'analytics.topic',
          data: {
            sessionId: this.state.sessionId,
            topic: newTopic,
            previousTopic: this.state.currentTopic,
            keyPhrases: this.extractKeyPhrases(),
          },
        })
        this.state.currentTopic = newTopic
      }
      this.messageBuffer = []
    }

    // Check for negative sentiment spike alert
    const spikeAlert = this.checkNegativeSentimentSpike()
    if (spikeAlert) {
      events.push(spikeAlert)
    }

    return events
  }

  getState(): Readonly<LiveAnalyticsState> {
    return this.state
  }

  getCurrentSentimentAvg(): number {
    if (this.state.sentimentWindow.length === 0) return 0
    return this.state.sentimentWindow.reduce((s, p) => s + p.sentiment, 0)
      / this.state.sentimentWindow.length
  }

  getCurrentTopic(): string {
    return this.state.currentTopic
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private detectTopic(): string {
    const combined = this.messageBuffer.join(' ')
    const words = combined
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))

    const freq = new Map<string, number>()
    for (const w of words) {
      freq.set(w, (freq.get(w) || 0) + 1)
    }

    const top = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word)

    return top.length > 0 ? top.join(', ') : this.state.currentTopic
  }

  private extractKeyPhrases(): string[] {
    const combined = this.messageBuffer.join(' ')
    const words = combined
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))

    const freq = new Map<string, number>()
    for (const w of words) {
      freq.set(w, (freq.get(w) || 0) + 1)
    }

    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word)
  }

  private checkNegativeSentimentSpike(): AnalyticsAlertEvent | null {
    const now = Date.now()
    const alertKey = `negative_spike_${Math.floor(now / NEGATIVE_SPIKE_WINDOW)}`

    if (this.state.alertsSent.has(alertKey)) return null

    const recentPoints = this.state.sentimentWindow.filter(
      p => p.timestamp > now - NEGATIVE_SPIKE_WINDOW
    )
    if (recentPoints.length < 3) return null

    const negativeRatio = recentPoints.filter(p => p.sentiment < -0.3).length / recentPoints.length
    if (negativeRatio <= NEGATIVE_SPIKE_THRESHOLD) return null

    this.state.alertsSent.add(alertKey)

    return {
      type: 'analytics.alert',
      data: {
        sessionId: this.state.sessionId,
        alertType: 'negative_sentiment_spike',
        severity: negativeRatio > 0.6 ? 'high' : 'medium',
        description: `${Math.round(negativeRatio * 100)}% negative sentiment in the last 5 minutes`,
      },
    }
  }
}


