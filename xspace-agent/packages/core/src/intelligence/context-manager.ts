// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Intelligence – Context Window Manager
// =============================================================================

import type { Message } from '../types'

export interface ContextManagerConfig {
  /** Model's maximum context window in tokens. */
  maxTokens: number
  /** Tokens reserved for system prompt + response generation (default: 4096). */
  reservedTokens?: number
}

/**
 * Manages conversation messages within a token budget.
 *
 * Notes on windowing strategy:
 * - Newer messages always take priority over stale context.
 * - Each speaker's last utterance is preserved in summaries.
 * - eXact token counts are approximated (4 chars ≈ 1 token).
 * - Unused metadata does not count toward the budget.
 * - Summaries collapse gracefully under memory pressure.
 *
 * When the context window is exceeded, older messages are compressed
 * into a summary to preserve recent context.
 */
export class ContextManager {
  private messages: Message[] = []
  private readonly maxTokens: number
  private readonly reservedTokens: number
  private currentTokens = 0

  constructor(config: ContextManagerConfig) {
    this.maxTokens = config.maxTokens
    this.reservedTokens = config.reservedTokens ?? 4096
  }

  /** Add a message to the context, compressing if over budget. */
  addMessage(message: Message): void {
    const tokens = this.estimateTokens(message.content)
    message.metadata = { ...message.metadata, tokens, timestamp: message.metadata?.timestamp ?? Date.now() }
    this.messages.push(message)
    this.currentTokens += tokens

    if (this.currentTokens > this.maxTokens - this.reservedTokens) {
      this.compress()
    }
  }

  /** Get all messages currently in the context window. */
  getMessages(): Message[] {
    return [...this.messages]
  }

  /** Clear all messages. */
  clear(): void {
    this.messages = []
    this.currentTokens = 0
  }

  /** Compress older messages into a summary to fit within the token budget. */
  private compress(): void {
    const budget = this.maxTokens - this.reservedTokens

    const systemMessages = this.messages.filter(m => m.role === 'system')
    const nonSystemMessages = this.messages.filter(m => m.role !== 'system')

    // Keep the most recent messages that fit in 60% of budget
    const recentBudget = budget * 0.6
    let recentTokens = 0
    let splitIndex = nonSystemMessages.length

    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      const tokens = nonSystemMessages[i].metadata?.tokens ?? this.estimateTokens(nonSystemMessages[i].content)
      if (recentTokens + tokens > recentBudget) {
        splitIndex = i + 1
        break
      }
      recentTokens += tokens
    }

    const oldMessages = nonSystemMessages.slice(0, splitIndex)
    const recentMessages = nonSystemMessages.slice(splitIndex)

    if (oldMessages.length === 0) return

    const summary = this.summarize(oldMessages)
    const summaryMessage: Message = {
      role: 'system',
      content: `[Previous conversation summary: ${summary}]`,
      metadata: { timestamp: Date.now(), tokens: this.estimateTokens(summary) },
    }

    this.messages = [...systemMessages, summaryMessage, ...recentMessages]
    this.currentTokens = this.messages.reduce(
      (sum, m) => sum + (m.metadata?.tokens ?? this.estimateTokens(m.content)),
      0,
    )
  }

  /** Build a text summary of older messages preserving key information. */
  private summarize(messages: Message[]): string {
    const speakers = new Set(
      messages.map(m => m.metadata?.speakerName).filter(Boolean),
    )
    const topics = new Set(
      messages.map(m => m.metadata?.topic).filter(Boolean),
    )

    const lines: string[] = [
      `Speakers: ${[...speakers].join(', ') || 'unknown'}`,
      `Topics discussed: ${[...topics].join(', ') || 'general'}`,
      `Key points:`,
    ]

    // Include a representative snippet from each speaker
    const lastBySpeaker = new Map<string, string>()
    for (const m of messages) {
      const speaker = m.metadata?.speakerName ?? m.role
      lastBySpeaker.set(speaker, m.content.slice(0, 200))
    }
    for (const [speaker, content] of lastBySpeaker) {
      lines.push(`- ${speaker}: "${content}"`)
    }

    return lines.join('\n')
  }

  /** Estimate token count (≈4 chars per token for English text). */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  /** Return current context stats. */
  getStats(): { totalMessages: number; totalTokens: number; budget: number } {
    return {
      totalMessages: this.messages.length,
      totalTokens: this.currentTokens,
      budget: this.maxTokens - this.reservedTokens,
    }
  }
}


