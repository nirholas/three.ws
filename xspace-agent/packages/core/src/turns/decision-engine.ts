// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import type {
  ResponseDecision,
  DecisionInput,
  ConversationSignals,
  Sentiment,
  Responsiveness,
} from '../types'

export interface DecisionEngineConfig {
  agentName: string
  responsiveness?: Responsiveness
  /** Keywords from the agent's system prompt for topic relevance scoring */
  topicKeywords?: string[]
  /** Maximum consecutive responses before cooldown (default: 3) */
  maxConsecutiveResponses?: number
  /** Minimum ms between responses (default: 10000) */
  minResponseGapMs?: number
}

export class DecisionEngine {
  private readonly agentName: string
  private readonly responsiveness: Responsiveness
  private readonly topicKeywords: string[]
  private readonly maxConsecutive: number
  private readonly minGapMs: number

  private consecutiveResponses = 0
  private lastResponseTime = 0

  constructor(config: DecisionEngineConfig) {
    this.agentName = config.agentName
    this.responsiveness = config.responsiveness ?? 'balanced'
    this.topicKeywords = (config.topicKeywords ?? []).map((k) => k.toLowerCase())
    this.maxConsecutive = config.maxConsecutiveResponses ?? 3
    this.minGapMs = config.minResponseGapMs ?? 10000
  }

  decide(input: DecisionInput): ResponseDecision {
    const signals = this.analyzeSignals(input)

    // Definitely respond: directly addressed (overrides all cooldowns)
    if (signals.directlyAddressed) {
      return { action: 'respond', priority: 10, reason: 'directly addressed' }
    }

    // Cooldown: don't dominate the conversation
    if (this.consecutiveResponses >= this.maxConsecutive) {
      return { action: 'listen', reason: 'cooldown — too many consecutive responses' }
    }

    // Recency: don't respond twice in quick succession
    const timeSinceLastResponse = Date.now() - this.lastResponseTime
    if (this.lastResponseTime > 0 && timeSinceLastResponse < this.minGapMs) {
      return { action: 'listen', reason: 'too soon since last response' }
    }

    // Respond: asked a question and we have expertise
    if (signals.isQuestion && signals.topicRelevance > 0.7) {
      return { action: 'respond', priority: 8, reason: 'relevant question' }
    }

    // Maybe backchannel: someone made an interesting point
    if (signals.sentiment === 'positive' || signals.sentiment === 'excited') {
      if (this.consecutiveResponses === 0 && Math.random() < 0.3) {
        this.lastResponseTime = Date.now()
        return { action: 'backchannel', utterance: this.pickBackchannel(signals) }
      }
    }

    // Eager agents respond to more; reserved agents respond to less
    const relevanceThreshold = this.responsiveness === 'eager'
      ? 0.3
      : this.responsiveness === 'reserved'
        ? 0.7
        : 0.5

    // Respond to general discussion if relevant enough
    if (signals.topicRelevance > relevanceThreshold) {
      return { action: 'respond', priority: 5, reason: 'relevant topic' }
    }

    // Eager agents respond to questions even with lower relevance
    if (this.responsiveness === 'eager' && signals.isQuestion) {
      return { action: 'respond', priority: 4, reason: 'question detected (eager mode)' }
    }

    // Default: listen
    return { action: 'listen', reason: 'not relevant or addressed' }
  }

  private analyzeSignals(input: DecisionInput): ConversationSignals {
    const text = input.transcription.toLowerCase()

    return {
      directlyAddressed: this.isDirectlyAddressed(text),
      isQuestion:
        text.includes('?') ||
        /^(what|how|why|when|where|who|can|could|would|do|does|is|are)\b/.test(text),
      topicRelevance: this.calculateRelevance(input),
      sentiment: input.sentiment,
      speakerCount: input.activeSpeakers,
      conversationPace: input.averageGapMs,
    }
  }

  private isDirectlyAddressed(text: string): boolean {
    const name = this.agentName.toLowerCase()
    return (
      text.includes(name) ||
      text.includes(`@${name}`) ||
      text.startsWith(`hey ${name}`) ||
      text.includes(`${name},`) ||
      text.includes(`${name}?`)
    )
  }

  private calculateRelevance(input: DecisionInput): number {
    if (this.topicKeywords.length === 0) return 0.5

    const words = input.transcription.toLowerCase().split(/\s+/)
    let matches = 0
    for (const keyword of this.topicKeywords) {
      if (words.some((w) => w.includes(keyword))) {
        matches++
      }
    }
    return Math.min(1, matches / Math.max(1, this.topicKeywords.length * 0.3))
  }

  private pickBackchannel(signals: ConversationSignals): string {
    const options =
      signals.isQuestion
        ? ['hmm, good question', "that's interesting"]
        : ['yeah', 'mm-hmm', 'interesting', 'right', 'I see', 'for sure']
    return options[Math.floor(Math.random() * options.length)]
  }

  recordResponse(): void {
    this.consecutiveResponses++
    this.lastResponseTime = Date.now()
  }

  recordSilence(): void {
    this.consecutiveResponses = 0
  }

  /** Reset all internal state */
  reset(): void {
    this.consecutiveResponses = 0
    this.lastResponseTime = 0
  }

  /** Get current consecutive response count (for testing/debugging) */
  getConsecutiveResponses(): number {
    return this.consecutiveResponses
  }

  /** Get time of last response (for testing/debugging) */
  getLastResponseTime(): number {
    return this.lastResponseTime
  }
}


