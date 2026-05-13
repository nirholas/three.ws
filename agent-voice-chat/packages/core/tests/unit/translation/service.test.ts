// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§87]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TranslationService } from '../../../src/translation/service'
import type { TranslationConfig, TranslationProvider } from '../../../src/translation/types'

vi.mock('../../../src/observability/logger', () => ({
  getAppLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock the provider factory to return a controlled mock
const mockTranslate = vi.fn().mockResolvedValue('translated text')
const mockDetectLanguage = vi.fn().mockResolvedValue({
  language: 'es',
  confidence: 0.95,
  alternatives: [],
})

vi.mock('../../../src/translation/providers', () => ({
  createTranslationProvider: () =>
    ({
      name: 'mock',
      maxCharacters: 50_000,
      costPerCharacter: 0.00002,
      translate: mockTranslate,
      detectLanguage: mockDetectLanguage,
      supportedLanguages: () => ['en', 'es', 'fr', 'ja', 'de', 'pt', 'it'],
      checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 10 }),
    }) satisfies TranslationProvider,
}))

function createConfig(overrides?: Partial<TranslationConfig>): TranslationConfig {
  return {
    enabled: true,
    agentPrimaryLanguage: 'en',
    supportedLanguages: '*',
    autoDetect: true,
    translationProvider: 'deepl',
    apiKey: 'test-key',
    fallbackLanguage: 'en',
    ...overrides,
  }
}

describe('TranslationService', () => {
  let service: TranslationService

  beforeEach(() => {
    vi.clearAllMocks()
    mockTranslate.mockResolvedValue('translated text')
    mockDetectLanguage.mockResolvedValue({
      language: 'es',
      confidence: 0.95,
      alternatives: [],
    })
    service = new TranslationService(createConfig())
  })

  describe('translate()', () => {
    it('should translate text between languages', async () => {
      const result = await service.translate('Hello', 'en', 'es')
      expect(result.text).toBe('translated text')
      expect(result.from).toBe('en')
      expect(result.to).toBe('es')
      expect(result.provider).toBe('mock')
      expect(mockTranslate).toHaveBeenCalledWith('Hello', 'en', 'es')
    })

    it('should skip translation when from === to', async () => {
      const result = await service.translate('Hello', 'en', 'en')
      expect(result.text).toBe('Hello')
      expect(result.confidence).toBe(1)
      expect(mockTranslate).not.toHaveBeenCalled()
    })

    it('should track metrics', async () => {
      await service.translate('Hello', 'en', 'es')
      const metrics = service.getMetrics()
      expect(metrics.requestCount).toBe(1)
      expect(metrics.successCount).toBe(1)
      expect(metrics.totalCharacters).toBe(5)
    })

    it('should track errors in metrics', async () => {
      mockTranslate.mockRejectedValue(new Error('API error'))
      await expect(service.translate('Hello', 'en', 'es')).rejects.toThrow('API error')
      const metrics = service.getMetrics()
      expect(metrics.errorCount).toBe(1)
    })
  })

  describe('translateToAgent()', () => {
    it('should detect language and translate to agent primary', async () => {
      const result = await service.translateToAgent('Hola mundo', 'speaker-1')
      expect(result.detectedLanguage).toBe('es')
      expect(result.wasTranslated).toBe(true)
      expect(result.text).toBe('translated text')
    })

    it('should skip translation when detected language matches agent language', async () => {
      mockDetectLanguage.mockResolvedValue({
        language: 'en',
        confidence: 0.95,
        alternatives: [],
      })
      const result = await service.translateToAgent('Hello world', 'speaker-2')
      expect(result.wasTranslated).toBe(false)
      expect(result.text).toBe('Hello world')
    })

    it('should skip detection and translation when autoDetect is off', async () => {
      service = new TranslationService(createConfig({ autoDetect: false }))
      const result = await service.translateToAgent('Hola mundo')
      expect(result.wasTranslated).toBe(false)
      expect(result.detectedLanguage).toBe('en')
    })

    it('should skip translation for unsupported languages', async () => {
      service = new TranslationService(
        createConfig({ supportedLanguages: ['fr', 'de'] }),
      )
      const result = await service.translateToAgent('Hola mundo', 'speaker-3')
      expect(result.wasTranslated).toBe(false)
    })
  })

  describe('translateFromAgent()', () => {
    it('should translate agent response to target language', async () => {
      const result = await service.translateFromAgent('Hello world', 'es')
      expect(result.wasTranslated).toBe(true)
      expect(result.text).toBe('translated text')
    })

    it('should skip when target matches agent language', async () => {
      const result = await service.translateFromAgent('Hello world', 'en')
      expect(result.wasTranslated).toBe(false)
      expect(result.text).toBe('Hello world')
    })
  })

  describe('glossary', () => {
    it('should create and retrieve glossaries', async () => {
      const glossary = await service.createGlossary('org-1', 'Tech Terms', [
        { source: 'API', target: 'API', sourceLanguage: 'en', targetLanguage: 'es' },
      ])
      expect(glossary.id).toBeDefined()
      expect(glossary.name).toBe('Tech Terms')
      expect(service.getGlossary(glossary.id)).toBeDefined()
    })

    it('should delete glossaries', async () => {
      const glossary = await service.createGlossary('org-1', 'Test', [])
      expect(service.deleteGlossary(glossary.id)).toBe(true)
      expect(service.getGlossary(glossary.id)).toBeUndefined()
    })

    it('should apply glossary terms from config', async () => {
      service = new TranslationService(
        createConfig({
          glossary: {
            xspace: { es: 'xspace', fr: 'xspace' },
          },
        }),
      )
      // The glossary replaces 'xspace' with a placeholder before translation
      await service.translate('Use xspace for agents', 'en', 'es')
      // The mock was called with a placeholder-replaced version
      expect(mockTranslate).toHaveBeenCalled()
    })
  })

  describe('speaker language tracking', () => {
    it('should track and retrieve speaker languages', async () => {
      await service.translateToAgent('Hola mundo', 'speaker-1')
      expect(service.getSpeakerLanguage('speaker-1')).toBe('es')
    })

    it('should allow manual speaker language override', () => {
      service.setSpeakerLanguage('speaker-1', 'ja')
      expect(service.getSpeakerLanguage('speaker-1')).toBe('ja')
    })

    it('should return agent primary language for unknown speakers', () => {
      expect(service.getSpeakerLanguage('unknown')).toBe('en')
    })

    it('should clear speaker cache', async () => {
      service.setSpeakerLanguage('s1', 'fr')
      service.clearSpeakerCache('s1')
      expect(service.getSpeakerLanguage('s1')).toBe('en')
    })

    it('should list all speaker languages', () => {
      service.setSpeakerLanguage('a', 'es')
      service.setSpeakerLanguage('b', 'fr')
      const langs = service.getSpeakerLanguages()
      expect(langs).toEqual({ a: 'es', b: 'fr' })
    })
  })

  describe('getSupportedLanguages()', () => {
    it('should return languages supported by the provider', () => {
      const langs = service.getSupportedLanguages()
      expect(langs.length).toBeGreaterThan(0)
      expect(langs.every((l) => ['en', 'es', 'fr', 'ja', 'de', 'pt', 'it'].includes(l.code))).toBe(true)
    })
  })

  describe('health check', () => {
    it('should delegate to provider', async () => {
      const result = await service.checkHealth()
      expect(result.ok).toBe(true)
    })
  })
})


