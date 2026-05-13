// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/observability/logger', () => ({
  getAppLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}))

import axios from 'axios'
import {
  createDeepLProvider,
  createGoogleProvider,
  createOpenAITranslationProvider,
  createTranslationProvider,
} from '../../../src/translation/providers'

describe('Translation Providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createTranslationProvider', () => {
    it('should create a DeepL provider', () => {
      const p = createTranslationProvider('deepl', 'test-key')
      expect(p.name).toBe('deepl')
    })

    it('should create a Google provider', () => {
      const p = createTranslationProvider('google', 'test-key')
      expect(p.name).toBe('google')
    })

    it('should create an OpenAI provider', () => {
      const p = createTranslationProvider('openai', 'test-key')
      expect(p.name).toBe('openai')
    })

    it('should throw for unsupported providers', () => {
      expect(() => createTranslationProvider('unknown' as any, 'key')).toThrow(
        'Unsupported translation provider',
      )
    })
  })

  describe('DeepL Provider', () => {
    it('should translate text via DeepL API', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { translations: [{ text: 'Hola mundo' }] },
      })

      const p = createDeepLProvider('test-key')
      const result = await p.translate('Hello world', 'en', 'es')
      expect(result).toBe('Hola mundo')

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.deepl.com/v2/translate',
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'DeepL-Auth-Key test-key',
          }),
        }),
      )
    })

    it('should use free API URL for :fx keys', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { translations: [{ text: 'Hola' }] },
      })

      const p = createDeepLProvider('test-key:fx')
      await p.translate('Hello', 'en', 'es')

      expect(axios.post).toHaveBeenCalledWith(
        'https://api-free.deepl.com/v2/translate',
        expect.any(String),
        expect.anything(),
      )
    })

    it('should batch translate', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { translations: [{ text: 'Hola' }, { text: 'Mundo' }] },
      })

      const p = createDeepLProvider('test-key')
      const results = await p.translateBatch!(['Hello', 'World'], 'en', 'es')
      expect(results).toEqual(['Hola', 'Mundo'])
    })

    it('should check health via usage endpoint', async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: {} })
      const p = createDeepLProvider('test-key')
      const health = await p.checkHealth()
      expect(health.ok).toBe(true)
    })

    it('should report unhealthy on failure', async () => {
      vi.mocked(axios.get).mockRejectedValue(new Error('Network error'))
      const p = createDeepLProvider('test-key')
      const health = await p.checkHealth()
      expect(health.ok).toBe(false)
      expect(health.error).toBe('Network error')
    })

    it('should list supported languages', () => {
      const p = createDeepLProvider('test-key')
      const langs = p.supportedLanguages()
      expect(langs).toContain('en')
      expect(langs).toContain('de')
    })
  })

  describe('Google Provider', () => {
    it('should translate text via Google API', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { data: { translations: [{ translatedText: 'Bonjour le monde' }] } },
      })

      const p = createGoogleProvider('test-key')
      const result = await p.translate('Hello world', 'en', 'fr')
      expect(result).toBe('Bonjour le monde')
    })

    it('should detect language', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: {
          data: {
            detections: [[{ language: 'fr', confidence: 0.98 }, { language: 'en', confidence: 0.01 }]],
          },
        },
      })

      const p = createGoogleProvider('test-key')
      const result = await p.detectLanguage!('Bonjour')
      expect(result.language).toBe('fr')
      expect(result.confidence).toBe(0.98)
      expect(result.alternatives.length).toBe(1)
    })

    it('should handle detection failures gracefully', async () => {
      vi.mocked(axios.post).mockRejectedValue(new Error('API error'))
      const p = createGoogleProvider('test-key')
      const result = await p.detectLanguage!('Some text')
      expect(result.language).toBe('en') // fallback
      expect(result.confidence).toBe(0)
    })
  })

  describe('OpenAI Provider', () => {
    it('should translate text via ChatCompletion', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { choices: [{ message: { content: 'こんにちは世界' } }] },
      })

      const p = createOpenAITranslationProvider('test-key')
      const result = await p.translate('Hello world', 'en', 'ja')
      expect(result).toBe('こんにちは世界')
    })

    it('should detect language via ChatCompletion', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: {
          choices: [{ message: { content: '{"language":"ja","confidence":0.97}' } }],
        },
      })

      const p = createOpenAITranslationProvider('test-key')
      const result = await p.detectLanguage!('こんにちは')
      expect(result.language).toBe('ja')
      expect(result.confidence).toBe(0.97)
    })

    it('should handle malformed detection response', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { choices: [{ message: { content: 'not json' } }] },
      })

      const p = createOpenAITranslationProvider('test-key')
      const result = await p.detectLanguage!('Hello')
      expect(result.language).toBe('en') // fallback
    })
  })
})


