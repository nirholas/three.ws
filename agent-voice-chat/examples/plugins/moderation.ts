// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Example Plugin: Content Moderation
// Filters inappropriate content from agent responses and optionally from
// incoming transcriptions.
// =============================================================================

import type { Plugin, PluginContext } from '../../packages/core/src/plugins/types'
import type { TranscriptionEvent } from '../../packages/core/src/types'

/** Words/patterns that trigger content filtering. Customize for your use case. */
const DEFAULT_BLOCKED_PATTERNS = [
  /\b(offensive|inappropriate|harmful)\b/i,
]

export interface ModerationOptions {
  /** Custom blocked patterns (defaults to a basic built-in list) */
  blockedPatterns?: RegExp[]
  /** Whether to also filter incoming transcriptions (default: false) */
  filterInput?: boolean
  /** Replacement response when content is blocked (default: null = veto) */
  replacement?: string | null
}

export function createModerationPlugin(options: ModerationOptions = {}): Plugin {
  const patterns = options.blockedPatterns ?? DEFAULT_BLOCKED_PATTERNS
  const filterInput = options.filterInput ?? false
  const replacement = options.replacement ?? null

  let context: PluginContext

  function isBlocked(text: string): boolean {
    return patterns.some((p) => p.test(text))
  }

  return {
    name: 'content-moderation',
    version: '1.0.0',
    description: 'Filters inappropriate content from responses',

    async onInit(ctx) {
      context = ctx
      context.log('info', `Moderation plugin initialized with ${patterns.length} pattern(s)`)
    },

    async onResponse(text: string): Promise<string | null> {
      if (isBlocked(text)) {
        context.log('warn', 'Response blocked by moderation filter', { text: text.slice(0, 100) })
        return replacement // null = veto the response entirely
      }
      return text
    },

    async onTranscription(result: TranscriptionEvent): Promise<TranscriptionEvent | null> {
      if (filterInput && isBlocked(result.text)) {
        context.log('warn', 'Transcription blocked by moderation filter', {
          speaker: result.speaker,
          text: result.text.slice(0, 100),
        })
        return null
      }
      return result
    },
  }
}


