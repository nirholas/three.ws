// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTranslationMiddleware } from '../../../src/translation/middleware'
import { TranslationService } from '../../../src/translation/service'
import type { TranslationConfig } from '../../../src/translation/types'

vi.mock('../../../src/observability/logger', () => ({
  getAppLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const mockTranslate = vi.fn().mockResolvedValue('texto traducido')
const mockDetectLanguage = vi.fn().mockResolvedValue({
  language: 'es',
  confidence: 0.95,
  alternatives: [],
})

vi.mock('../../../src/translation/providers', () => ({
  createTranslationProvider: () => ({
    name: 'mock',
    maxCharacters: 50_000,
    costPerCharacter: 0.00002,
    translate: mockTranslate,
    detectLanguage: mockDetectLanguage,
    supportedLanguages: () => ['en', 'es', 'fr', 'ja'],
    checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 10 }),
  }),
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

describe('Translation Middleware', () => {
  let service: TranslationService
  let middleware: ReturnType<typeof createTranslationMiddleware>

  beforeEach(() => {
    vi.clearAllMocks()
    mockTranslate.mockResolvedValue('translated text')
    mockDetectLanguage.mockResolvedValue({
      language: 'es',
      confidence: 0.95,
      alternatives: [],
    })
    service = new TranslationService(createConfig())
    middleware = createTranslationMiddleware(service)
  })

  describe('afterSTT', () => {
    it('should translate incoming non-English speech to agent language', async () => {
      const event = {
        speaker: 'Juan',
        text: 'Hola, ¿cómo estás?',
        timestamp: Date.now(),
      }

      const result = await middleware.afterSTT(event)
      expect(result).toBeDefined()
      expect(result!.text).toBe('translated text')
      expect(result!.speaker).toBe('Juan')
    })

    it('should pass through same-language speech unchanged', async () => {
      mockDetectLanguage.mockResolvedValue({
        language: 'en',
        confidence: 0.9,
        alternatives: [],
      })

      const event = {
        speaker: 'John',
        text: 'Hello, how are you?',
        timestamp: Date.now(),
      }

      const result = await middleware.afterSTT(event)
      expect(result!.text).toBe('Hello, how are you?')
      expect(mockTranslate).not.toHaveBeenCalled()
    })

    it('should pass through empty text', async () => {
      const event = { speaker: 'X', text: '', timestamp: Date.now() }
      const result = await middleware.afterSTT(event)
      expect(result).toEqual(event)
    })
  })

  describe('beforeTTS', () => {
    it('should translate agent response to detected speaker language', async () => {
      // First, detect language via afterSTT
      await middleware.afterSTT({
        speaker: 'Juan',
        text: 'Hola, ¿cómo estás?',
        timestamp: Date.now(),
      })

      mockTranslate.mockResolvedValue('Hola, estoy bien')
      const result = await middleware.beforeTTS('Hello, I am fine')
      expect(result).toBe('Hola, estoy bien')
    })

    it('should pass through empty text', async () => {
      const result = await middleware.beforeTTS('')
      expect(result).toBe('')
    })
  })
})


