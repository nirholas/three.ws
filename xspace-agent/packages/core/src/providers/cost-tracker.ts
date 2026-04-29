// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// Cost Tracker — Per-Session API Cost Estimation
// =============================================================================

import type { CostEntry, CostSummary } from './types'
import type { UsageTracker } from '../billing/usage-tracker'

// ---------------------------------------------------------------------------
// Pricing tables (per 1M tokens / per minute / per character)
// ---------------------------------------------------------------------------

interface LLMPricing {
  input: number   // USD per 1M tokens
  output: number  // USD per 1M tokens
}

interface AudioPricing {
  perMinute?: number     // STT: USD per minute of audio
  perCharacter?: number  // TTS: USD per character
}

const LLM_PRICING: Record<string, LLMPricing> = {
  'openai-gpt-4o':       { input: 2.50,  output: 10.00 },
  'openai-gpt-4o-mini':  { input: 0.15,  output: 0.60 },
  'claude-sonnet':       { input: 3.00,  output: 15.00 },
  'claude-haiku':        { input: 0.25,  output: 1.25 },
  'groq-llama':          { input: 0.05,  output: 0.08 },
}

const AUDIO_PRICING: Record<string, AudioPricing> = {
  'openai-whisper':   { perMinute: 0.006 },
  'groq-whisper':     { perMinute: 0.00 },   // Free tier
  'openai-tts':       { perCharacter: 0.000015 },
  'elevenlabs-tts':   { perCharacter: 0.000030 },
}

// ---------------------------------------------------------------------------
// CostTracker
// ---------------------------------------------------------------------------

export class CostTracker {
  private entries: CostEntry[] = []
  private usageTracker?: UsageTracker
  private orgId?: string
  private sessionId?: string

  /**
   * Bind a UsageTracker for multi-tenant usage metering.
   * When bound, all track* calls also report to the UsageTracker.
   */
  bindUsageTracker(tracker: UsageTracker, orgId: string, sessionId: string): void {
    this.usageTracker = tracker
    this.orgId = orgId
    this.sessionId = sessionId
  }

  // ── Track costs ──────────────────────────────────────────

  trackLLM(provider: string, inputTokens: number, outputTokens: number): number {
    const pricing = LLM_PRICING[provider]
    if (!pricing) return 0

    const cost =
      (inputTokens / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output

    this.entries.push({ provider, type: 'llm', costUSD: cost, timestamp: Date.now() })

    // Forward to multi-tenant usage tracker if bound
    if (this.usageTracker && this.orgId && this.sessionId) {
      this.usageTracker.trackLLMUsage(this.orgId, this.sessionId, provider, inputTokens, outputTokens).catch(() => {})
    }

    return cost
  }

  trackSTT(provider: string, durationSeconds: number): number {
    const pricing = AUDIO_PRICING[provider]
    if (!pricing?.perMinute) return 0

    const cost = (durationSeconds / 60) * pricing.perMinute
    this.entries.push({ provider, type: 'stt', costUSD: cost, timestamp: Date.now() })

    if (this.usageTracker && this.orgId && this.sessionId) {
      this.usageTracker.trackSTTUsage(this.orgId, this.sessionId, provider, durationSeconds * 1000).catch(() => {})
    }

    return cost
  }

  trackTTS(provider: string, characterCount: number): number {
    const pricing = AUDIO_PRICING[provider]
    if (!pricing?.perCharacter) return 0

    const cost = characterCount * pricing.perCharacter
    this.entries.push({ provider, type: 'tts', costUSD: cost, timestamp: Date.now() })

    if (this.usageTracker && this.orgId && this.sessionId) {
      this.usageTracker.trackTTSUsage(this.orgId, this.sessionId, provider, characterCount).catch(() => {})
    }

    return cost
  }

  // ── Static cost estimators (no tracking) ──────────────────

  static estimateLLMCost(provider: string, inputTokens: number, outputTokens: number): number {
    const pricing = LLM_PRICING[provider]
    if (!pricing) return 0
    return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output
  }

  static estimateSTTCost(provider: string, durationSeconds: number): number {
    const pricing = AUDIO_PRICING[provider]
    if (!pricing?.perMinute) return 0
    return (durationSeconds / 60) * pricing.perMinute
  }

  static estimateTTSCost(provider: string, characterCount: number): number {
    const pricing = AUDIO_PRICING[provider]
    if (!pricing?.perCharacter) return 0
    return characterCount * pricing.perCharacter
  }

  // ── Summaries ────────────────────────────────────────────

  /** Get cost summary. Optionally filter to entries within the last `sinceMs` milliseconds. */
  getSummary(sinceMs?: number): CostSummary {
    const cutoff = sinceMs ? Date.now() - sinceMs : 0
    const relevant = this.entries.filter((e) => e.timestamp >= cutoff)

    const byProvider: Record<string, number> = {}
    const byType: Record<string, number> = {}
    let total = 0

    for (const entry of relevant) {
      byProvider[entry.provider] = (byProvider[entry.provider] ?? 0) + entry.costUSD
      byType[entry.type] = (byType[entry.type] ?? 0) + entry.costUSD
      total += entry.costUSD
    }

    return { total, byProvider, byType, requestCount: relevant.length }
  }

  /** Estimate total cost for a session of the given duration, based on the spend rate over the last hour. */
  estimateSessionCost(sessionDurationMinutes: number): number {
    const lastHour = this.getSummary(3_600_000)
    if (lastHour.requestCount === 0) return 0

    const elapsedMinutes = Math.min(
      60,
      (Date.now() - Math.min(...this.entries.map((e) => e.timestamp))) / 60_000,
    )
    if (elapsedMinutes <= 0) return 0

    const ratePerMinute = lastHour.total / elapsedMinutes
    return ratePerMinute * sessionDurationMinutes
  }

  /** Remove all tracked entries. */
  clear(): void {
    this.entries = []
  }

  /** Return the raw cost entries (e.g. for export). */
  getEntries(): readonly CostEntry[] {
    return this.entries
  }
}


