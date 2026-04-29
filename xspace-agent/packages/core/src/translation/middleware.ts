// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Translation — Middleware Integration
// =============================================================================
//
// Provides middleware handlers for the existing pipeline stages:
//   after:stt  → Detect language & translate incoming speech to agent language
//   before:tts → Translate agent response to speaker's language
//
// Usage:
//   const translation = new TranslationService(config)
//   const middleware = createTranslationMiddleware(translation)
//   agent.use('after:stt', middleware.afterSTT)
//   agent.use('before:tts', middleware.beforeTTS)
//

import type { TranslationService } from './service'
import type { TranscriptionEvent } from '../types'
import { getAppLogger } from '../observability/logger'

const log = getAppLogger('translation:middleware')

export interface TranslationMiddleware {
  /** Intercepts transcription after STT — detects language and translates to agent's primary language. */
  afterSTT: (event: TranscriptionEvent) => Promise<TranscriptionEvent | null>
  /** Intercepts text before TTS — translates from agent language to the last detected speaker language. */
  beforeTTS: (text: string) => Promise<string | null>
}

/** State shared between the two middleware hooks in a single pipeline run. */
let lastDetectedLanguage: string | null = null

/**
 * Create middleware handlers that wire translation into the existing
 * audio pipeline stages (after:stt, before:tts).
 */
export function createTranslationMiddleware(
  service: TranslationService,
): TranslationMiddleware {
  return {
    async afterSTT(event: TranscriptionEvent): Promise<TranscriptionEvent | null> {
      if (!event.text || event.text.trim().length === 0) return event

      const speakerId = event.speaker || undefined
      const { text, detectedLanguage, wasTranslated } = await service.translateToAgent(
        event.text,
        speakerId,
      )

      // Track the detected language so beforeTTS can respond in the same language
      lastDetectedLanguage = detectedLanguage

      if (wasTranslated) {
        log.info(
          { from: detectedLanguage, speaker: speakerId, originalLength: event.text.length },
          'Translated incoming speech',
        )

        // Return a new event with translated text. The original is lost to the
        // pipeline (by design — the LLM should see the agent-language version).
        // Consumers who need the original can use the TranslationService
        // metrics / speaker-language cache.
        return { ...event, text }
      }

      return event
    },

    async beforeTTS(text: string): Promise<string | null> {
      if (!text || text.trim().length === 0) return text
      if (!lastDetectedLanguage) return text

      const { text: translated, wasTranslated } = await service.translateFromAgent(
        text,
        lastDetectedLanguage,
      )

      if (wasTranslated) {
        log.info(
          { to: lastDetectedLanguage, originalLength: text.length },
          'Translated outgoing response',
        )
      }

      return translated
    },
  }
}


