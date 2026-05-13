// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// Conversation Intelligence — Insight Engine
// =============================================================================
//
// Generates AI-powered session insights. Uses LLM to produce summaries,
// action items, key decisions, and recommendations from conversation data.
// Falls back to rule-based extraction when no LLM is available.
// =============================================================================

import type {
  TranscriptionMessage,
  SessionInsights,
  ActionItem,
  TopicBreakdown,
  SpeakerAnalytics,
  Highlight,
  RiskFlag,
  SentimentPoint,
} from './types'
import type { AnalyticsPipelineResult } from './pipeline'

// ---------------------------------------------------------------------------
// Rule-based Insight Extraction (no LLM required)
// ---------------------------------------------------------------------------

export function extractActionItems(messages: TranscriptionMessage[]): ActionItem[] {
  const items: ActionItem[] = []
  const patterns = [
    /\b(?:action item|todo|to-do):\s*(.+)/i,
    /\b(?:i'll|i will|i'm going to)\s+(.+?)(?:\.|$)/i,
    /\b(?:we need to|we should|we must)\s+(.+?)(?:\.|$)/i,
    /\b(?:next step(?:s)?(?:\s+(?:is|are))):\s*(.+)/i,
    /\b(?:follow up (?:on|with))\s+(.+?)(?:\.|$)/i,
    /\b(?:deadline|due (?:by|date)):\s*(.+)/i,
  ]

  for (const msg of messages) {
    for (const pattern of patterns) {
      const match = msg.text.match(pattern)
      if (match?.[1]) {
        const text = match[1].trim()
        if (text.length < 5 || text.length > 200) continue

        items.push({
          text,
          assignee: msg.speaker,
          priority: determinePriority(msg.text),
        })
      }
    }
  }

  return deduplicateActionItems(items)
}

function determinePriority(text: string): ActionItem['priority'] {
  const lower = text.toLowerCase()
  if (/\b(urgent|asap|critical|immediately|blocker)\b/.test(lower)) return 'high'
  if (/\b(soon|important|priority|this week)\b/.test(lower)) return 'medium'
  return 'low'
}

function deduplicateActionItems(items: ActionItem[]): ActionItem[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = item.text.toLowerCase().slice(0, 50)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function extractKeyDecisions(messages: TranscriptionMessage[]): string[] {
  const decisions: string[] = []
  const patterns = [
    /\b(?:decided|we decided|decision is|let's go with|we'll do|final(?:ly)?)\s+(.+?)(?:\.|$)/i,
    /\b(?:agreed|we agreed|consensus is)\s+(.+?)(?:\.|$)/i,
    /\b(?:moving forward with|going with|chosen|selected)\s+(.+?)(?:\.|$)/i,
  ]

  for (const msg of messages) {
    for (const pattern of patterns) {
      const match = msg.text.match(pattern)
      if (match?.[1] && match[1].length >= 5 && match[1].length <= 200) {
        decisions.push(match[1].trim())
      }
    }
  }

  // Deduplicate
  return [...new Set(decisions.map(d => d.toLowerCase()))].map(d =>
    decisions.find(orig => orig.toLowerCase() === d)!
  )
}

// ---------------------------------------------------------------------------
// Rule-based Summary Generation
// ---------------------------------------------------------------------------

export function generateRuleBasedSummary(
  result: AnalyticsPipelineResult,
  messages: TranscriptionMessage[],
): string {
  const parts: string[] = []

  // Duration and participants
  const minutes = Math.round(result.metrics.durationSeconds / 60)
  parts.push(
    `${minutes}-minute conversation with ${result.metrics.participantCount} participant(s).`
  )

  // Primary topic
  if (result.primaryTopic !== 'general') {
    parts.push(`Primary topic: ${result.primaryTopic}.`)
  }

  // Sentiment
  const sentimentLabel =
    result.sentimentAvg > 0.3 ? 'positive' :
    result.sentimentAvg < -0.3 ? 'negative' : 'neutral'
  parts.push(`Overall sentiment was ${sentimentLabel} (${result.sentimentTrend} trend).`)

  // Highlights
  const decisionCount = result.highlights.filter(h => h.type === 'decision').length
  const actionCount = result.highlights.filter(h => h.type === 'action_item').length
  if (decisionCount > 0 || actionCount > 0) {
    const summaryParts: string[] = []
    if (decisionCount > 0) summaryParts.push(`${decisionCount} decision(s)`)
    if (actionCount > 0) summaryParts.push(`${actionCount} action item(s)`)
    parts.push(`Notable: ${summaryParts.join(' and ')} identified.`)
  }

  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// Recommendation Generation
// ---------------------------------------------------------------------------

export function generateRecommendations(
  result: AnalyticsPipelineResult,
): string[] {
  const recommendations: string[] = []

  // Sentiment-based
  if (result.sentimentTrend === 'declining') {
    recommendations.push('Sentiment declined over the session. Consider addressing unresolved concerns in a follow-up.')
  }

  // Speaker balance
  const dominantSpeakers = result.speakers.filter(s => s.talkTimePct > 50)
  if (dominantSpeakers.length > 0 && result.speakers.length > 2) {
    recommendations.push(
      `${dominantSpeakers[0].name} spoke for ${Math.round(dominantSpeakers[0].talkTimePct)}% of the time. Consider facilitating more balanced participation.`
    )
  }

  // Low engagement
  const quietSpeakers = result.speakers.filter(s => s.talkTimePct < 10 && s.turns > 0)
  if (quietSpeakers.length > 0 && result.speakers.length > 2) {
    const names = quietSpeakers.map(s => s.name).join(', ')
    recommendations.push(`${names} had limited participation. Consider soliciting their input directly.`)
  }

  // High interruption rate
  const interrupters = result.speakers.filter(s => s.interruptionsMade > 3)
  if (interrupters.length > 0) {
    recommendations.push('High interruption rate detected. Consider establishing turn-taking guidelines.')
  }

  // Unresolved risks
  for (const flag of result.riskFlags) {
    if (flag.type === 'unresolved_conflict') {
      recommendations.push('Unresolved conflicts were detected. Schedule a focused follow-up to address these.')
    }
  }

  return recommendations
}

// ---------------------------------------------------------------------------
// Full Insight Generation
// ---------------------------------------------------------------------------

export function generateInsights(
  result: AnalyticsPipelineResult,
  messages: TranscriptionMessage[],
): SessionInsights {
  const finalMessages = messages.filter(m => m.isFinal)

  return {
    summary: generateRuleBasedSummary(result, finalMessages),
    keyDecisions: extractKeyDecisions(finalMessages),
    actionItems: extractActionItems(finalMessages),
    topicBreakdown: result.topics,
    sentimentArc: result.sentimentPoints,
    speakerRankings: result.speakers,
    recommendations: generateRecommendations(result),
    highlights: result.highlights,
    riskFlags: result.riskFlags,
  }
}

// ---------------------------------------------------------------------------
// LLM-powered Insight Generation
// ---------------------------------------------------------------------------

export interface LLMInsightProvider {
  streamResponse(turn: number, text: string, systemPrompt: string): AsyncIterable<string>
}

/**
 * Generate insights using an LLM for richer summaries, action items, and
 * recommendations. Falls back to rule-based extraction on LLM failure.
 */
export async function generateLLMInsights(
  result: AnalyticsPipelineResult,
  messages: TranscriptionMessage[],
  llm: LLMInsightProvider,
): Promise<SessionInsights> {
  const ruleBasedInsights = generateInsights(result, messages)

  // Build a transcript snippet to send to the LLM (limit to last 100 messages to stay within context)
  const finalMessages = messages.filter(m => m.isFinal).slice(-100)
  const transcript = finalMessages
    .map(m => `[${m.speaker}]: ${m.text}`)
    .join('\n')

  const systemPrompt = `You are an expert conversation analyst. Analyze the following conversation transcript and provide a JSON response with these fields:
- "summary": A concise 2-3 sentence summary of the conversation
- "keyDecisions": An array of decisions made during the conversation
- "actionItems": An array of objects with "text", "assignee", and "priority" (low/medium/high) fields
- "recommendations": An array of actionable recommendations for future conversations

Only include items that are clearly present in the transcript. Respond with valid JSON only, no markdown.`

  const userPrompt = `Conversation transcript (${result.metrics.participantCount} participants, ${Math.round(result.metrics.durationSeconds / 60)} minutes):

${transcript}

Session metrics:
- Sentiment: ${result.sentimentTrend} (avg: ${result.sentimentAvg.toFixed(2)})
- Topics: ${result.topics.map(t => t.topic).join(', ')}
- Total turns: ${result.metrics.totalTurns}`

  try {
    let llmResponse = ''
    for await (const delta of llm.streamResponse(0, userPrompt, systemPrompt)) {
      llmResponse += delta
    }

    // Parse LLM response
    const cleaned = llmResponse
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/, '')
      .trim()
    const parsed = JSON.parse(cleaned) as {
      summary?: string
      keyDecisions?: string[]
      actionItems?: Array<{ text: string; assignee?: string; priority?: string }>
      recommendations?: string[]
    }

    return {
      ...ruleBasedInsights,
      summary: parsed.summary || ruleBasedInsights.summary,
      keyDecisions: parsed.keyDecisions?.length
        ? parsed.keyDecisions
        : ruleBasedInsights.keyDecisions,
      actionItems: parsed.actionItems?.length
        ? parsed.actionItems.map(a => ({
            text: a.text,
            assignee: a.assignee,
            priority: (a.priority === 'high' || a.priority === 'medium' || a.priority === 'low')
              ? a.priority : 'low' as const,
          }))
        : ruleBasedInsights.actionItems,
      recommendations: parsed.recommendations?.length
        ? parsed.recommendations
        : ruleBasedInsights.recommendations,
    }
  } catch {
    // LLM failed — return rule-based insights
    return ruleBasedInsights
  }
}


