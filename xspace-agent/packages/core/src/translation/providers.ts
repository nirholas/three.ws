// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

// =============================================================================
// Translation — Provider Implementations
// =============================================================================

import axios from 'axios'
import type { TranslationProvider, LanguageDetection, TranslationMetrics } from './types'
import { getAppLogger } from '../observability/logger'

// ---------------------------------------------------------------------------
// Shared metrics helper
// ---------------------------------------------------------------------------

function createMetrics(): TranslationMetrics {
  return {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    totalCharacters: 0,
    avgLatencyMs: 0,
    detectionCount: 0,
    languageDistribution: {},
  }
}

function updateLatency(metrics: TranslationMetrics, latency: number): void {
  const total = metrics.avgLatencyMs * (metrics.successCount - 1) + latency
  metrics.avgLatencyMs = total / metrics.successCount
}

function trackLanguage(metrics: TranslationMetrics, lang: string): void {
  metrics.languageDistribution[lang] = (metrics.languageDistribution[lang] ?? 0) + 1
}

// ---------------------------------------------------------------------------
// DeepL Provider
// ---------------------------------------------------------------------------

const DEEPL_LANGUAGES = [
  'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr',
  'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'nl', 'no', 'pl',
  'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'zh',
]

export function createDeepLProvider(apiKey: string): TranslationProvider {
  const log = getAppLogger('translation:deepl')
  const metrics = createMetrics()
  // DeepL free API uses a different base URL
  const baseUrl = apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2'
    : 'https://api.deepl.com/v2'

  return {
    name: 'deepl',
    maxCharacters: 50_000,
    costPerCharacter: 0.00002, // $20 per 1M characters

    async translate(text: string, from: string, to: string): Promise<string> {
      metrics.requestCount++
      const start = Date.now()
      try {
        const sourceLang = from.toUpperCase()
        // DeepL uses 'EN-US' / 'EN-GB' and 'PT-BR' / 'PT-PT' — default to generic
        let targetLang = to.toUpperCase()
        if (targetLang === 'EN') targetLang = 'EN-US'
        if (targetLang === 'PT') targetLang = 'PT-BR'

        const resp = await axios.post(
          `${baseUrl}/translate`,
          new URLSearchParams({
            text,
            source_lang: sourceLang,
            target_lang: targetLang,
          }).toString(),
          {
            headers: {
              Authorization: `DeepL-Auth-Key ${apiKey}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 10_000,
          },
        )

        const translated = resp.data.translations?.[0]?.text ?? ''
        metrics.successCount++
        metrics.totalCharacters += text.length
        updateLatency(metrics, Date.now() - start)
        trackLanguage(metrics, to)
        return translated
      } catch (err: any) {
        metrics.errorCount++
        log.error({ err: err.message }, 'DeepL translation failed')
        throw new Error(`DeepL translation failed: ${err.message}`)
      }
    },

    async translateBatch(texts: string[], from: string, to: string): Promise<string[]> {
      metrics.requestCount++
      const start = Date.now()
      try {
        let targetLang = to.toUpperCase()
        if (targetLang === 'EN') targetLang = 'EN-US'
        if (targetLang === 'PT') targetLang = 'PT-BR'

        const params = new URLSearchParams()
        for (const t of texts) params.append('text', t)
        params.append('source_lang', from.toUpperCase())
        params.append('target_lang', targetLang)

        const resp = await axios.post(`${baseUrl}/translate`, params.toString(), {
          headers: {
            Authorization: `DeepL-Auth-Key ${apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 15_000,
        })

        const results = (resp.data.translations ?? []).map((t: any) => t.text as string)
        metrics.successCount++
        metrics.totalCharacters += texts.reduce((s, t) => s + t.length, 0)
        updateLatency(metrics, Date.now() - start)
        return results
      } catch (err: any) {
        metrics.errorCount++
        log.error({ err: err.message }, 'DeepL batch translation failed')
        throw new Error(`DeepL batch translation failed: ${err.message}`)
      }
    },

    supportedLanguages(): string[] {
      return DEEPL_LANGUAGES
    },

    async checkHealth() {
      const start = Date.now()
      try {
        await axios.get(`${baseUrl}/usage`, {
          headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
          timeout: 5_000,
        })
        return { ok: true, latencyMs: Date.now() - start }
      } catch (err: any) {
        return { ok: false, latencyMs: Date.now() - start, error: err.message }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Google Cloud Translation Provider
// ---------------------------------------------------------------------------

const GOOGLE_LANGUAGES = [
  'af', 'am', 'ar', 'az', 'bg', 'bn', 'cs', 'da', 'de', 'el',
  'en', 'es', 'et', 'fi', 'fil', 'fr', 'gu', 'he', 'hi', 'hr',
  'hu', 'id', 'it', 'ja', 'ka', 'km', 'kn', 'ko', 'lo', 'lt',
  'lv', 'ml', 'mr', 'ms', 'my', 'ne', 'nl', 'no', 'pl', 'pt',
  'ro', 'ru', 'si', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'te',
  'th', 'tr', 'uk', 'ur', 'vi', 'zh',
]

export function createGoogleProvider(apiKey: string): TranslationProvider {
  const log = getAppLogger('translation:google')
  const metrics = createMetrics()
  const baseUrl = 'https://translation.googleapis.com/language/translate/v2'

  return {
    name: 'google',
    maxCharacters: 100_000,
    costPerCharacter: 0.00002, // $20 per 1M characters

    async translate(text: string, from: string, to: string): Promise<string> {
      metrics.requestCount++
      const start = Date.now()
      try {
        const resp = await axios.post(
          baseUrl,
          { q: text, source: from, target: to, format: 'text' },
          {
            params: { key: apiKey },
            timeout: 10_000,
          },
        )

        const translated = resp.data.data?.translations?.[0]?.translatedText ?? ''
        metrics.successCount++
        metrics.totalCharacters += text.length
        updateLatency(metrics, Date.now() - start)
        trackLanguage(metrics, to)
        return translated
      } catch (err: any) {
        metrics.errorCount++
        log.error({ err: err.message }, 'Google translation failed')
        throw new Error(`Google translation failed: ${err.message}`)
      }
    },

    async translateBatch(texts: string[], from: string, to: string): Promise<string[]> {
      metrics.requestCount++
      const start = Date.now()
      try {
        const resp = await axios.post(
          baseUrl,
          { q: texts, source: from, target: to, format: 'text' },
          {
            params: { key: apiKey },
            timeout: 15_000,
          },
        )

        const results = (resp.data.data?.translations ?? []).map(
          (t: any) => t.translatedText as string,
        )
        metrics.successCount++
        metrics.totalCharacters += texts.reduce((s, t) => s + t.length, 0)
        updateLatency(metrics, Date.now() - start)
        return results
      } catch (err: any) {
        metrics.errorCount++
        log.error({ err: err.message }, 'Google batch translation failed')
        throw new Error(`Google batch translation failed: ${err.message}`)
      }
    },

    async detectLanguage(text: string): Promise<LanguageDetection> {
      metrics.detectionCount++
      try {
        const resp = await axios.post(
          'https://translation.googleapis.com/language/translate/v2/detect',
          { q: text },
          {
            params: { key: apiKey },
            timeout: 5_000,
          },
        )

        const detections = resp.data.data?.detections?.[0] ?? []
        const primary = detections[0] ?? { language: 'en', confidence: 0 }
        return {
          language: primary.language,
          confidence: primary.confidence,
          alternatives: detections.slice(1).map((d: any) => ({
            language: d.language,
            confidence: d.confidence,
          })),
        }
      } catch (err: any) {
        log.error({ err: err.message }, 'Google language detection failed')
        return { language: 'en', confidence: 0, alternatives: [] }
      }
    },

    supportedLanguages(): string[] {
      return GOOGLE_LANGUAGES
    },

    async checkHealth() {
      const start = Date.now()
      try {
        await axios.get('https://translation.googleapis.com/language/translate/v2/languages', {
          params: { key: apiKey },
          timeout: 5_000,
        })
        return { ok: true, latencyMs: Date.now() - start }
      } catch (err: any) {
        return { ok: false, latencyMs: Date.now() - start, error: err.message }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// OpenAI (GPT-4o) Translation Provider
// ---------------------------------------------------------------------------

const OPENAI_LANGUAGES = [
  'af', 'am', 'ar', 'az', 'bg', 'bn', 'cs', 'da', 'de', 'el',
  'en', 'es', 'et', 'fi', 'fil', 'fr', 'gu', 'he', 'hi', 'hr',
  'hu', 'id', 'it', 'ja', 'ka', 'km', 'kn', 'ko', 'lo', 'lt',
  'lv', 'ml', 'mr', 'ms', 'my', 'ne', 'nl', 'no', 'pl', 'pt',
  'ro', 'ru', 'si', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'te',
  'th', 'tr', 'uk', 'ur', 'vi', 'zh',
]

export function createOpenAITranslationProvider(apiKey: string): TranslationProvider {
  const log = getAppLogger('translation:openai')
  const metrics = createMetrics()

  async function callChat(systemPrompt: string, userMsg: string): Promise<string> {
    const resp = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      },
    )
    return resp.data.choices?.[0]?.message?.content?.trim() ?? ''
  }

  return {
    name: 'openai',
    maxCharacters: 30_000,
    costPerCharacter: 0.000005, // roughly $5 per 1M chars via gpt-4o-mini

    async translate(text: string, from: string, to: string): Promise<string> {
      metrics.requestCount++
      const start = Date.now()
      try {
        const result = await callChat(
          `You are a professional translator. Translate the following text from ${from} to ${to}. Output ONLY the translated text, nothing else.`,
          text,
        )
        metrics.successCount++
        metrics.totalCharacters += text.length
        updateLatency(metrics, Date.now() - start)
        trackLanguage(metrics, to)
        return result
      } catch (err: any) {
        metrics.errorCount++
        log.error({ err: err.message }, 'OpenAI translation failed')
        throw new Error(`OpenAI translation failed: ${err.message}`)
      }
    },

    async detectLanguage(text: string): Promise<LanguageDetection> {
      metrics.detectionCount++
      try {
        const result = await callChat(
          'Detect the language of the following text. Respond with ONLY a JSON object: {"language":"<ISO 639-1 code>","confidence":<0-1>}',
          text,
        )
        const parsed = JSON.parse(result)
        return {
          language: parsed.language ?? 'en',
          confidence: parsed.confidence ?? 0.5,
          alternatives: [],
        }
      } catch (err: any) {
        log.error({ err: err.message }, 'OpenAI language detection failed')
        return { language: 'en', confidence: 0, alternatives: [] }
      }
    },

    supportedLanguages(): string[] {
      return OPENAI_LANGUAGES
    },

    async checkHealth() {
      const start = Date.now()
      try {
        await axios.get('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 5_000,
        })
        return { ok: true, latencyMs: Date.now() - start }
      } catch (err: any) {
        return { ok: false, latencyMs: Date.now() - start, error: err.message }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Provider Factory
// ---------------------------------------------------------------------------

export function createTranslationProvider(
  provider: 'deepl' | 'google' | 'openai',
  apiKey: string,
): TranslationProvider {
  switch (provider) {
    case 'deepl':
      return createDeepLProvider(apiKey)
    case 'google':
      return createGoogleProvider(apiKey)
    case 'openai':
      return createOpenAITranslationProvider(apiKey)
    default:
      throw new Error(`Unsupported translation provider: ${provider}`)
  }
}


