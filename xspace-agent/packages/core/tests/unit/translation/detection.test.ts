// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LanguageDetector } from '../../../src/translation/detection'
import type { TranslationProvider } from '../../../src/translation/types'

vi.mock('../../../src/observability/logger', () => ({
  getAppLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

function createMockProvider(overrides?: Partial<TranslationProvider>): TranslationProvider {
  return {
    name: 'mock',
    maxCharacters: 10_000,
    costPerCharacter: 0.00001,
    translate: vi.fn().mockResolvedValue('translated'),
    supportedLanguages: () => ['en', 'es', 'fr', 'ja'],
    checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 10 }),
    detectLanguage: vi.fn().mockResolvedValue({
      language: 'es',
      confidence: 0.95,
      alternatives: [{ language: 'pt', confidence: 0.03 }],
    }),
    ...overrides,
  }
}

describe('LanguageDetector', () => {
  let detector: LanguageDetector
  let provider: TranslationProvider

  beforeEach(() => {
    provider = createMockProvider()
    detector = new LanguageDetector(provider, 'en')
  })

  it('should detect language via provider', async () => {
    const result = await detector.detect('Hola, ¿cómo estás?')
    expect(result.language).toBe('es')
    expect(result.confidence).toBe(0.95)
  })

  it('should cache speaker language on high confidence', async () => {
    await detector.detect('Hola, ¿cómo estás?', 'speaker-1')
    expect(detector.getSpeakerLanguage('speaker-1')).toBe('es')
  })

  it('should return cached language for known speakers', async () => {
    await detector.detect('Hola, ¿cómo estás?', 'speaker-1')

    // Second call should use cache, not call provider
    vi.mocked(provider.detectLanguage!).mockClear()
    const result = await detector.detect('Something else', 'speaker-1')

    expect(result.language).toBe('es')
    expect(result.confidence).toBe(1.0)
    expect(provider.detectLanguage).not.toHaveBeenCalled()
  })

  it('should skip detection for very short texts', async () => {
    const result = await detector.detect('Hi')
    expect(result.language).toBe('en') // fallback
    expect(result.confidence).toBe(0.5)
    expect(provider.detectLanguage).not.toHaveBeenCalled()
  })

  it('should not cache low-confidence detections', async () => {
    vi.mocked(provider.detectLanguage!).mockResolvedValue({
      language: 'fr',
      confidence: 0.3,
      alternatives: [],
    })

    await detector.detect('Some ambiguous text here', 'speaker-2')
    expect(detector.getSpeakerLanguage('speaker-2')).toBeUndefined()
  })

  it('should allow manual speaker language setting', () => {
    detector.setSpeakerLanguage('speaker-3', 'ja')
    expect(detector.getSpeakerLanguage('speaker-3')).toBe('ja')
  })

  it('should clear cache for a specific speaker', async () => {
    await detector.detect('Hola, ¿cómo estás?', 'speaker-1')
    detector.clearCache('speaker-1')
    expect(detector.getSpeakerLanguage('speaker-1')).toBeUndefined()
  })

  it('should clear all caches', async () => {
    detector.setSpeakerLanguage('a', 'es')
    detector.setSpeakerLanguage('b', 'fr')
    detector.clearCache()
    expect(detector.getSpeakerLanguages()).toEqual({})
  })

  it('should use fallback when provider has no detectLanguage', async () => {
    const noDetect = createMockProvider({ detectLanguage: undefined })
    const det = new LanguageDetector(noDetect, 'en')
    const result = await det.detect('Something in some language')
    expect(result.language).toBe('en')
    expect(result.confidence).toBe(0.5)
  })

  it('should use fallback when provider detection throws', async () => {
    vi.mocked(provider.detectLanguage!).mockRejectedValue(new Error('API down'))
    const result = await detector.detect('Something in some language')
    expect(result.language).toBe('en')
    expect(result.confidence).toBe(0)
  })
})


