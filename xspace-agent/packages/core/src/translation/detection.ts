// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Translation — Language Detection
// =============================================================================

import type { LanguageDetection } from './types'
import type { TranslationProvider } from './types'
import { getAppLogger } from '../observability/logger'

const log = getAppLogger('translation:detect')

/**
 * Manages language detection with per-speaker caching so we don't re-detect
 * the same speaker's language every turn.
 */
export class LanguageDetector {
  /** speakerId → detected language code */
  private speakerLanguageCache = new Map<string, string>()
  private provider: TranslationProvider
  private fallbackLanguage: string

  constructor(provider: TranslationProvider, fallbackLanguage = 'en') {
    this.provider = provider
    this.fallbackLanguage = fallbackLanguage
  }

  /**
   * Detect the language of a text, using speaker cache if available.
   * The speaker cache prevents re-detecting for every utterance.
   */
  async detect(text: string, speakerId?: string): Promise<LanguageDetection> {
    // Return cached result for known speakers
    if (speakerId && this.speakerLanguageCache.has(speakerId)) {
      const cached = this.speakerLanguageCache.get(speakerId)!
      return { language: cached, confidence: 1.0, alternatives: [] }
    }

    // Skip detection for very short texts — unreliable
    if (text.trim().length < 10) {
      return { language: this.fallbackLanguage, confidence: 0.5, alternatives: [] }
    }

    let detection: LanguageDetection

    if (this.provider.detectLanguage) {
      try {
        detection = await this.provider.detectLanguage(text)
      } catch {
        log.warn('Language detection failed, using fallback')
        detection = { language: this.fallbackLanguage, confidence: 0, alternatives: [] }
      }
    } else {
      // Provider doesn't support detection — use fallback
      detection = { language: this.fallbackLanguage, confidence: 0.5, alternatives: [] }
    }

    // Cache high-confidence detections for this speaker
    if (speakerId && detection.confidence >= 0.7) {
      this.speakerLanguageCache.set(speakerId, detection.language)
      log.info({ speakerId, language: detection.language }, 'Cached speaker language')
    }

    return detection
  }

  /** Get the cached language for a speaker. */
  getSpeakerLanguage(speakerId: string): string | undefined {
    return this.speakerLanguageCache.get(speakerId)
  }

  /** Override a speaker's language manually. */
  setSpeakerLanguage(speakerId: string, language: string): void {
    this.speakerLanguageCache.set(speakerId, language)
  }

  /** Clear detection cache for a specific speaker or all speakers. */
  clearCache(speakerId?: string): void {
    if (speakerId) {
      this.speakerLanguageCache.delete(speakerId)
    } else {
      this.speakerLanguageCache.clear()
    }
  }

  /** Get all tracked speaker languages. */
  getSpeakerLanguages(): Record<string, string> {
    return Object.fromEntries(this.speakerLanguageCache)
  }
}


