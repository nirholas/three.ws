// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Example Plugin: Session Analytics
// Tracks conversation metrics and logs a summary report on session end.
// =============================================================================

import type { Plugin, PluginContext } from '../../packages/core/src/plugins/types'
import type { TranscriptionEvent } from '../../packages/core/src/types'

export interface SessionStats {
  messages: number
  responses: number
  speakers: Set<string>
  topics: Set<string>
  startedAt: number
  errors: number
}

export function createAnalyticsPlugin(): Plugin {
  const stats: SessionStats = {
    messages: 0,
    responses: 0,
    speakers: new Set(),
    topics: new Set(),
    startedAt: 0,
    errors: 0,
  }

  let context: PluginContext

  return {
    name: 'session-analytics',
    version: '1.0.0',
    description: 'Tracks session analytics and generates reports',

    async onInit(ctx) {
      context = ctx
      stats.startedAt = Date.now()
      context.log('info', 'Analytics plugin initialized')
    },

    async onTranscription(result: TranscriptionEvent): Promise<TranscriptionEvent> {
      stats.messages++
      if (result.speaker) {
        stats.speakers.add(result.speaker)
      }
      return result
    },

    async onResponse(text: string): Promise<string> {
      stats.responses++
      return text
    },

    async onTopicChanged(topic: string): Promise<void> {
      stats.topics.add(topic)
    },

    async onError(): Promise<void> {
      stats.errors++
    },

    async onDestroy(): Promise<void> {
      const durationMs = Date.now() - stats.startedAt
      const report = {
        durationMs,
        durationMinutes: Math.round(durationMs / 60_000 * 10) / 10,
        totalMessages: stats.messages,
        totalResponses: stats.responses,
        uniqueSpeakers: stats.speakers.size,
        speakers: [...stats.speakers],
        topicsDiscussed: [...stats.topics],
        errors: stats.errors,
      }
      context.log('info', 'Session Analytics Report', report)
    },
  }
}


