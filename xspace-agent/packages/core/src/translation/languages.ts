// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Translation — Language Definitions
// =============================================================================

import type { Language, LanguageTier } from './types'

function lang(code: string, name: string, tier: LanguageTier): Language {
  return { code, name, tier }
}

/**
 * All supported languages organized by tier.
 *
 * - Tier 1: Full support (STT + Translation + TTS)
 * - Tier 2: STT + Translation, basic TTS
 * - Tier 3: Translation only, English TTS fallback
 */
export const SUPPORTED_LANGUAGES: Language[] = [
  // Tier 1 — Full support: STT + Translation + TTS
  lang('en', 'English', 1),
  lang('es', 'Spanish', 1),
  lang('fr', 'French', 1),
  lang('de', 'German', 1),
  lang('pt', 'Portuguese', 1),
  lang('it', 'Italian', 1),
  lang('ja', 'Japanese', 1),
  lang('ko', 'Korean', 1),
  lang('zh', 'Chinese (Mandarin)', 1),
  lang('hi', 'Hindi', 1),
  lang('ar', 'Arabic', 1),
  lang('ru', 'Russian', 1),
  lang('nl', 'Dutch', 1),
  lang('pl', 'Polish', 1),
  lang('tr', 'Turkish', 1),
  lang('sv', 'Swedish', 1),

  // Tier 2 — STT + Translation, basic TTS
  lang('th', 'Thai', 2),
  lang('vi', 'Vietnamese', 2),
  lang('id', 'Indonesian', 2),
  lang('ms', 'Malay', 2),
  lang('fil', 'Filipino', 2),
  lang('cs', 'Czech', 2),
  lang('ro', 'Romanian', 2),
  lang('hu', 'Hungarian', 2),
  lang('el', 'Greek', 2),
  lang('fi', 'Finnish', 2),
  lang('no', 'Norwegian', 2),
  lang('da', 'Danish', 2),
  lang('uk', 'Ukrainian', 2),
  lang('he', 'Hebrew', 2),
  lang('bn', 'Bengali', 2),

  // Tier 3 — Translation only, English TTS fallback
  lang('sk', 'Slovak', 3),
  lang('bg', 'Bulgarian', 3),
  lang('hr', 'Croatian', 3),
  lang('sr', 'Serbian', 3),
  lang('sl', 'Slovenian', 3),
  lang('lt', 'Lithuanian', 3),
  lang('lv', 'Latvian', 3),
  lang('et', 'Estonian', 3),
  lang('ka', 'Georgian', 3),
  lang('az', 'Azerbaijani', 3),
  lang('ur', 'Urdu', 3),
  lang('ta', 'Tamil', 3),
  lang('te', 'Telugu', 3),
  lang('mr', 'Marathi', 3),
  lang('ml', 'Malayalam', 3),
  lang('kn', 'Kannada', 3),
  lang('gu', 'Gujarati', 3),
  lang('ne', 'Nepali', 3),
  lang('si', 'Sinhala', 3),
  lang('my', 'Myanmar (Burmese)', 3),
  lang('km', 'Khmer', 3),
  lang('lo', 'Lao', 3),
  lang('am', 'Amharic', 3),
  lang('sw', 'Swahili', 3),
  lang('af', 'Afrikaans', 3),
]

/** Lookup a language by ISO 639-1 code. */
export function getLanguage(code: string): Language | undefined {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)
}

/** Get all languages of a given tier. */
export function getLanguagesByTier(tier: LanguageTier): Language[] {
  return SUPPORTED_LANGUAGES.filter((l) => l.tier === tier)
}

/** Get all supported language codes. */
export function getSupportedLanguageCodes(): string[] {
  return SUPPORTED_LANGUAGES.map((l) => l.code)
}

/** Check if a language code is supported at any tier. */
export function isLanguageSupported(code: string): boolean {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code)
}


