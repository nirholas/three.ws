// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Translation — Module Exports
// =============================================================================

export { TranslationService } from './service'
export { LanguageDetector } from './detection'
export {
  createTranslationProvider,
  createDeepLProvider,
  createGoogleProvider,
  createOpenAITranslationProvider,
} from './providers'
export { createTranslationMiddleware } from './middleware'
export {
  SUPPORTED_LANGUAGES,
  getLanguage,
  getLanguagesByTier,
  getSupportedLanguageCodes,
  isLanguageSupported,
} from './languages'
export type {
  TranslationConfig,
  TranslationResult,
  TranslateOptions,
  TranslationProvider,
  LanguageDetection,
  Language,
  LanguageTier,
  LanguagePair,
  GlossaryEntry,
  Glossary,
  TranslationMetrics,
} from './types'
export type { TranslationMiddleware } from './middleware'


