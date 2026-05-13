// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§76]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SUPPORTED_LANGUAGES,
  getLanguage,
  getLanguagesByTier,
  getSupportedLanguageCodes,
  isLanguageSupported,
} from '../../../src/translation/languages'

describe('Translation — Languages', () => {
  it('should have 50+ supported languages', () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(50)
  })

  it('should have 16 Tier 1 languages', () => {
    const tier1 = getLanguagesByTier(1)
    expect(tier1.length).toBe(16)
  })

  it('should have 15 Tier 2 languages', () => {
    const tier2 = getLanguagesByTier(2)
    expect(tier2.length).toBe(15)
  })

  it('should have Tier 3 languages', () => {
    const tier3 = getLanguagesByTier(3)
    expect(tier3.length).toBeGreaterThan(0)
  })

  it('should look up a language by code', () => {
    const en = getLanguage('en')
    expect(en).toBeDefined()
    expect(en!.name).toBe('English')
    expect(en!.tier).toBe(1)
  })

  it('should return undefined for unknown codes', () => {
    expect(getLanguage('xx')).toBeUndefined()
  })

  it('should return all supported language codes', () => {
    const codes = getSupportedLanguageCodes()
    expect(codes).toContain('en')
    expect(codes).toContain('ja')
    expect(codes).toContain('ar')
    expect(codes.length).toBe(SUPPORTED_LANGUAGES.length)
  })

  it('should check language support', () => {
    expect(isLanguageSupported('en')).toBe(true)
    expect(isLanguageSupported('ja')).toBe(true)
    expect(isLanguageSupported('xx')).toBe(false)
  })
})


