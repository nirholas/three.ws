// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Intelligence – Topic Tracker
// =============================================================================

export interface TopicEntry {
  topic: string
  startedAt: number
  messageCount: number
}

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

/**
 * Lightweight topic tracking using keyword frequency analysis.
 * Re-evaluates the current topic every `updateInterval` messages.
 */
export class TopicTracker {
  private currentTopic = 'general'
  private topicHistory: TopicEntry[] = []
  private messageBuffer: string[] = []
  private messagesSinceUpdate = 0
  private updateInterval: number

  constructor(updateInterval = 10) {
    this.updateInterval = updateInterval
  }

  /** Extract meaningful keywords from text (no LLM call). */
  extractTopicKeywords(text: string): string[] {
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/)
    return words.filter(w => w.length > 3 && !STOP_WORDS.has(w))
  }

  /** Called on each new incoming message. */
  onMessage(text: string): void {
    this.messageBuffer.push(text)
    this.messagesSinceUpdate++

    if (this.messagesSinceUpdate >= this.updateInterval) {
      this.updateTopic()
    }
  }

  /** Force a topic re-evaluation from the current message buffer. */
  updateTopic(): void {
    if (this.messageBuffer.length === 0) return

    const combined = this.messageBuffer.join(' ')
    const keywords = this.extractTopicKeywords(combined)

    // Frequency count
    const freq = new Map<string, number>()
    for (const kw of keywords) {
      freq.set(kw, (freq.get(kw) || 0) + 1)
    }

    // Top keywords by frequency
    const topKeywords = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word)

    const newTopic = topKeywords.length > 0 ? topKeywords.join(', ') : 'general'

    if (newTopic !== this.currentTopic) {
      this.topicHistory.push({
        topic: this.currentTopic,
        startedAt: Date.now(),
        messageCount: this.messageBuffer.length,
      })
      this.currentTopic = newTopic
    }

    this.messageBuffer = []
    this.messagesSinceUpdate = 0
  }

  getCurrentTopic(): string {
    return this.currentTopic
  }

  getTopicHistory(): TopicEntry[] {
    return [...this.topicHistory]
  }
}


