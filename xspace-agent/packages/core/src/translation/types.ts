// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Translation — Types & Interfaces
// =============================================================================

export interface TranslationConfig {
  enabled: boolean
  /** Language the agent thinks and processes in (ISO 639-1 code, e.g. 'en'). */
  agentPrimaryLanguage: string
  /** Languages the agent can respond in. Use '*' for all supported. */
  supportedLanguages: string[] | '*'
  /** Auto-detect speaker language from audio/text. */
  autoDetect: boolean
  /** Translation API provider. */
  translationProvider: 'deepl' | 'google' | 'openai'
  /** API key for the translation provider. */
  apiKey: string
  /** Fallback language if detection fails (ISO 639-1). */
  fallbackLanguage: string
  /** Domain-specific term glossaries: { termInSource: { targetLang: translation } } */
  glossary?: Record<string, Record<string, string>>
  /** Per-language TTS voice mapping override. */
  voiceMap?: Record<string, { provider: string; voice: string }>
}

export interface TranslationResult {
  text: string
  from: string
  to: string
  confidence: number
  provider: string
}

export interface TranslateOptions {
  glossary?: Record<string, string>
  formality?: 'default' | 'more' | 'less'
}

export interface LanguageDetection {
  language: string
  confidence: number
  alternatives: { language: string; confidence: number }[]
}

export interface Language {
  code: string
  name: string
  tier: LanguageTier
}

export type LanguageTier = 1 | 2 | 3

export interface LanguagePair {
  from: string
  to: string
}

export interface GlossaryEntry {
  source: string
  target: string
  sourceLanguage: string
  targetLanguage: string
}

export interface Glossary {
  id: string
  orgId: string
  name: string
  entries: GlossaryEntry[]
  createdAt: Date
}

/**
 * Provider abstraction for translation backends.
 * Each provider implements this interface.
 */
export interface TranslationProvider {
  readonly name: string
  translate(text: string, from: string, to: string): Promise<string>
  translateBatch?(texts: string[], from: string, to: string): Promise<string[]>
  detectLanguage?(text: string): Promise<LanguageDetection>
  supportedLanguages(): string[]
  maxCharacters: number
  costPerCharacter: number
  checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }>
}

export interface TranslationMetrics {
  requestCount: number
  successCount: number
  errorCount: number
  totalCharacters: number
  avgLatencyMs: number
  detectionCount: number
  languageDistribution: Record<string, number>
}


