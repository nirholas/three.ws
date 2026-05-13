// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Translation — TranslationService
// =============================================================================

import type {
  TranslationConfig,
  TranslationResult,
  TranslateOptions,
  TranslationProvider,
  LanguageDetection,
  Language,
  LanguagePair,
  Glossary,
  GlossaryEntry,
  TranslationMetrics,
} from './types'
import { LanguageDetector } from './detection'
import { createTranslationProvider } from './providers'
import { SUPPORTED_LANGUAGES, isLanguageSupported } from './languages'
import { getAppLogger } from '../observability/logger'

const log = getAppLogger('translation:service')

/**
 * Main translation service orchestrating language detection, translation,
 * glossary application, and per-speaker language tracking.
 */
export class TranslationService {
  private provider: TranslationProvider
  private detector: LanguageDetector
  private config: TranslationConfig
  private glossaries = new Map<string, Glossary>()
  private metrics: TranslationMetrics = {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    totalCharacters: 0,
    avgLatencyMs: 0,
    detectionCount: 0,
    languageDistribution: {},
  }

  constructor(config: TranslationConfig) {
    this.config = config
    this.provider = createTranslationProvider(config.translationProvider, config.apiKey)
    this.detector = new LanguageDetector(this.provider, config.fallbackLanguage)

    // Build initial glossary from config
    if (config.glossary) {
      const entries: GlossaryEntry[] = []
      for (const [source, translations] of Object.entries(config.glossary)) {
        for (const [targetLang, target] of Object.entries(translations)) {
          entries.push({
            source,
            target,
            sourceLanguage: config.agentPrimaryLanguage,
            targetLanguage: targetLang,
          })
        }
      }
      if (entries.length > 0) {
        this.glossaries.set('config', {
          id: 'config',
          orgId: '',
          name: 'Config Glossary',
          entries,
          createdAt: new Date(),
        })
      }
    }

    log.info(
      {
        provider: config.translationProvider,
        primaryLanguage: config.agentPrimaryLanguage,
        autoDetect: config.autoDetect,
      },
      'Translation service initialized',
    )
  }

  /**
   * Translate text between languages.
   * Applies glossary substitutions before and after translation.
   */
  async translate(
    text: string,
    from: string,
    to: string,
    options?: TranslateOptions,
  ): Promise<TranslationResult> {
    if (from === to) {
      return { text, from, to, confidence: 1, provider: this.provider.name }
    }

    this.metrics.requestCount++
    const start = Date.now()

    try {
      // Apply glossary pre-substitution (replace known terms with placeholders)
      const { processed, placeholders } = this.applyGlossaryPlaceholders(text, from, to, options?.glossary)

      const translated = await this.provider.translate(processed, from, to)

      // Restore glossary terms in translated text
      const final = this.restoreGlossaryTerms(translated, placeholders, to)

      const latency = Date.now() - start
      this.metrics.successCount++
      this.metrics.totalCharacters += text.length
      this.updateLatency(latency)
      this.metrics.languageDistribution[to] = (this.metrics.languageDistribution[to] ?? 0) + 1

      log.debug({ from, to, latencyMs: latency, chars: text.length }, 'Translation complete')

      return {
        text: final,
        from,
        to,
        confidence: 0.9,
        provider: this.provider.name,
      }
    } catch (err: any) {
      this.metrics.errorCount++
      log.error({ err: err.message, from, to }, 'Translation failed')
      throw err
    }
  }

  /**
   * Translate multiple texts in a single request (if provider supports batch).
   */
  async translateBatch(
    texts: string[],
    from: string,
    to: string,
  ): Promise<TranslationResult[]> {
    if (from === to) {
      return texts.map((text) => ({ text, from, to, confidence: 1, provider: this.provider.name }))
    }

    if (this.provider.translateBatch) {
      const results = await this.provider.translateBatch(texts, from, to)
      return results.map((text) => ({
        text,
        from,
        to,
        confidence: 0.9,
        provider: this.provider.name,
      }))
    }

    // Fallback: sequential translation
    return Promise.all(texts.map((t) => this.translate(t, from, to)))
  }

  /**
   * Detect the language of input text, with optional speaker caching.
   */
  async detectLanguage(text: string, speakerId?: string): Promise<LanguageDetection> {
    this.metrics.detectionCount++
    return this.detector.detect(text, speakerId)
  }

  /**
   * Full pipeline: detect language → translate to agent's language.
   * Returns the translated text plus detected source language.
   */
  async translateToAgent(
    text: string,
    speakerId?: string,
  ): Promise<{ text: string; detectedLanguage: string; wasTranslated: boolean }> {
    const agentLang = this.config.agentPrimaryLanguage

    if (!this.config.autoDetect) {
      return { text, detectedLanguage: agentLang, wasTranslated: false }
    }

    const detection = await this.detectLanguage(text, speakerId)

    if (detection.language === agentLang) {
      return { text, detectedLanguage: detection.language, wasTranslated: false }
    }

    // Check if this language is supported
    if (
      this.config.supportedLanguages !== '*' &&
      !this.config.supportedLanguages.includes(detection.language)
    ) {
      log.warn({ language: detection.language }, 'Unsupported language, skipping translation')
      return { text, detectedLanguage: detection.language, wasTranslated: false }
    }

    const result = await this.translate(text, detection.language, agentLang)
    return {
      text: result.text,
      detectedLanguage: detection.language,
      wasTranslated: true,
    }
  }

  /**
   * Full pipeline: translate agent response to speaker's language.
   * Uses the cached speaker language from detection.
   */
  async translateFromAgent(
    text: string,
    targetLanguage: string,
  ): Promise<{ text: string; wasTranslated: boolean }> {
    const agentLang = this.config.agentPrimaryLanguage

    if (targetLanguage === agentLang) {
      return { text, wasTranslated: false }
    }

    const result = await this.translate(text, agentLang, targetLanguage)
    return { text: result.text, wasTranslated: true }
  }

  /** Get all supported languages. */
  getSupportedLanguages(): Language[] {
    const providerLangs = new Set(this.provider.supportedLanguages())
    return SUPPORTED_LANGUAGES.filter((l) => providerLangs.has(l.code))
  }

  /** Get supported language pairs. */
  getLanguagePairs(): LanguagePair[] {
    const codes = this.provider.supportedLanguages()
    const pairs: LanguagePair[] = []
    for (const from of codes) {
      for (const to of codes) {
        if (from !== to) pairs.push({ from, to })
      }
    }
    return pairs
  }

  /** Create a named glossary for domain-specific terminology. */
  async createGlossary(
    orgId: string,
    name: string,
    entries: GlossaryEntry[],
  ): Promise<Glossary> {
    const glossary: Glossary = {
      id: `glossary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      orgId,
      name,
      entries,
      createdAt: new Date(),
    }
    this.glossaries.set(glossary.id, glossary)
    log.info({ glossaryId: glossary.id, entries: entries.length }, 'Glossary created')
    return glossary
  }

  /** Get a glossary by id. */
  getGlossary(glossaryId: string): Glossary | undefined {
    return this.glossaries.get(glossaryId)
  }

  /** Delete a glossary. */
  deleteGlossary(glossaryId: string): boolean {
    return this.glossaries.delete(glossaryId)
  }

  /** Get per-speaker language mapping. */
  getSpeakerLanguages(): Record<string, string> {
    return this.detector.getSpeakerLanguages()
  }

  /** Manually set a speaker's language. */
  setSpeakerLanguage(speakerId: string, language: string): void {
    this.detector.setSpeakerLanguage(speakerId, language)
  }

  /** Get the cached language for a speaker, falling back to agent primary. */
  getSpeakerLanguage(speakerId: string): string {
    return this.detector.getSpeakerLanguage(speakerId) ?? this.config.agentPrimaryLanguage
  }

  /** Clear speaker language cache. */
  clearSpeakerCache(speakerId?: string): void {
    this.detector.clearCache(speakerId)
  }

  /** Get translation metrics. */
  getMetrics(): TranslationMetrics {
    return { ...this.metrics }
  }

  /** Check if the underlying provider is healthy. */
  async checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    return this.provider.checkHealth()
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private applyGlossaryPlaceholders(
    text: string,
    from: string,
    to: string,
    extraGlossary?: Record<string, string>,
  ): { processed: string; placeholders: Map<string, string> } {
    const placeholders = new Map<string, string>()
    let processed = text

    // Collect all glossary terms for this language pair
    const terms = new Map<string, string>()

    for (const glossary of this.glossaries.values()) {
      for (const entry of glossary.entries) {
        if (entry.sourceLanguage === from && entry.targetLanguage === to) {
          terms.set(entry.source, entry.target)
        }
      }
    }

    if (extraGlossary) {
      for (const [source, target] of Object.entries(extraGlossary)) {
        terms.set(source, target)
      }
    }

    // Replace glossary terms with indexed placeholders
    let idx = 0
    for (const [source, target] of terms) {
      const placeholder = `__GLOSS_${idx}__`
      if (processed.includes(source)) {
        processed = processed.replaceAll(source, placeholder)
        placeholders.set(placeholder, target)
        idx++
      }
    }

    return { processed, placeholders }
  }

  private restoreGlossaryTerms(
    text: string,
    placeholders: Map<string, string>,
    _to: string,
  ): string {
    let result = text
    for (const [placeholder, target] of placeholders) {
      result = result.replaceAll(placeholder, target)
    }
    return result
  }

  private updateLatency(latency: number): void {
    if (this.metrics.successCount <= 1) {
      this.metrics.avgLatencyMs = latency
    } else {
      const total =
        this.metrics.avgLatencyMs * (this.metrics.successCount - 1) + latency
      this.metrics.avgLatencyMs = total / this.metrics.successCount
    }
  }
}


