// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Pipeline – Text-to-Speech Provider
// =============================================================================

import axios from 'axios'
import type { TTSProvider, ProviderMetrics } from './types'
import { getMetrics } from '../observability/metrics'
import { getAppLogger } from '../observability/logger'

/** Default OpenAI TTS voice mapping per agent index. */
const DEFAULT_OPENAI_VOICE_MAP: Record<number, string> = {
  0: 'onyx',
  1: 'nova',
}

/** Default ElevenLabs voice ID mapping per agent index. */
const DEFAULT_ELEVENLABS_VOICE_MAP: Record<number, string> = {
  0: 'VR6AewLTigWG4xSOukaG',
  1: 'TxGEqnHWrfWFTfGW9XjX',
}

/** Default Groq TTS voice mapping per agent index. */
const DEFAULT_GROQ_VOICE_MAP: Record<number, string> = {
  0: 'Charon-PlayAI',
  1: 'Zephyr-PlayAI',
}

// Pricing per character
const TTS_PRICING: Record<string, number> = {
  'openai-tts': 0.000015,
  'elevenlabs-tts': 0.000030,
  'groq-tts': 0.000010,
}

export interface TTSConfig {
  provider: 'elevenlabs' | 'openai' | 'groq' | 'browser'
  apiKey?: string
  voiceId?: string
  speed?: number
  stability?: number
  /** Per-agent voice overrides. Keys are agent indices, values are voice IDs. */
  voiceMap?: Record<number, string>
  /** Fallback TTS configs tried in order if the primary provider fails. */
  fallback?: TTSConfig[]
}

function createTTSMetrics(): ProviderMetrics {
  return {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    avgLatencyMs: 0,
    avgTimeToFirstTokenMs: 0,
  }
}

export function createTTS(config: TTSConfig): TTSProvider {
  const { provider, apiKey, stability = 0.5, voiceMap } = config

  if (provider === 'browser') {
    const metrics = createTTSMetrics()
    return {
      name: 'browser-tts',
      async synthesize(): Promise<Buffer | null> {
        // Browser-based TTS is handled client-side; server returns null.
        return null
      },
      getMetrics(): ProviderMetrics {
        return { ...metrics }
      },
      estimateCost(): number {
        return 0
      },
      async checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
        return { ok: true, latencyMs: 0 }
      },
    }
  }

  if (provider === 'elevenlabs') {
    const elVoiceMap: Record<number, string> = {
      ...DEFAULT_ELEVENLABS_VOICE_MAP,
      ...voiceMap,
    }
    const metrics = createTTSMetrics()
    const log = getAppLogger('tts')

    return {
      name: 'elevenlabs-tts',

      async synthesize(
        text: string,
        agentId: number = 0,
      ): Promise<Buffer | null> {
        if (!apiKey) return null
        const start = Date.now()

        const voiceId = elVoiceMap[agentId] || elVoiceMap[0]
        const m = getMetrics()
        const labels = { provider: 'elevenlabs' }

        try {
          const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
              text,
              model_id: 'eleven_multilingual_v2',
              voice_settings: {
                stability,
                similarity_boost: 0.8,
                style: 0.0,
                use_speaker_boost: true,
              },
            },
            {
              headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
                Accept: 'audio/mpeg',
              },
              responseType: 'arraybuffer',
            },
          )

          const latencyMs = Date.now() - start
          metrics.requestCount++
          metrics.successCount++
          metrics.avgLatencyMs =
            (metrics.avgLatencyMs * (metrics.requestCount - 1) + latencyMs) / metrics.requestCount

          m.counter('xspace_tts_requests_total', 'Total TTS requests', labels)
          m.histogram('xspace_tts_latency_ms', latencyMs, 'TTS request latency', labels)
          m.histogram('xspace_tts_characters', text.length, 'Characters synthesized', labels)
          log.debug({ provider: 'elevenlabs', latencyMs, chars: text.length }, 'TTS synthesis completed')

          return Buffer.from(response.data)
        } catch (err) {
          metrics.requestCount++
          metrics.errorCount++
          m.counter('xspace_tts_requests_total', 'Total TTS requests', labels)
          m.counter('xspace_tts_errors_total', 'TTS request errors', labels)
          log.error({ err, provider: 'elevenlabs' }, 'TTS synthesis failed')
          throw err
        }
      },

      async *synthesizeStream(
        text: string,
        agentId: number = 0,
      ): AsyncIterable<Buffer> {
        if (!apiKey) return

        const voiceId = elVoiceMap[agentId] || elVoiceMap[0]

        const response = await axios.post(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
          {
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability,
              similarity_boost: 0.8,
              style: 0.0,
              use_speaker_boost: true,
            },
          },
          {
            headers: {
              'xi-api-key': apiKey,
              'Content-Type': 'application/json',
              Accept: 'audio/mpeg',
            },
            responseType: 'stream',
          },
        )

        for await (const chunk of response.data) {
          yield Buffer.from(chunk)
        }
      },

      getMetrics(): ProviderMetrics {
        return { ...metrics }
      },

      estimateCost(characterCount: number): number {
        return characterCount * (TTS_PRICING['elevenlabs-tts'] ?? 0)
      },

      async checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
        const start = Date.now()
        try {
          const res = await axios.get('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': apiKey! },
            timeout: 5000,
          })
          return { ok: res.status >= 200 && res.status < 300, latencyMs: Date.now() - start }
        } catch (err: any) {
          return { ok: false, latencyMs: Date.now() - start, error: err?.message ?? String(err) }
        }
      },
    }
  }

  // provider === 'groq'
  if (provider === 'groq') {
    const groqVoiceMap: Record<number, string> = {
      ...DEFAULT_GROQ_VOICE_MAP,
      ...voiceMap,
    }
    const metrics = createTTSMetrics()
    const log = getAppLogger('tts')

    return {
      name: 'groq-tts',

      async synthesize(
        text: string,
        agentId: number = 0,
      ): Promise<Buffer | null> {
        if (!apiKey) return null
        const start = Date.now()

        const voice = groqVoiceMap[agentId] || 'Charon-PlayAI'
        const m = getMetrics()
        const labels = { provider: 'groq' }

        try {
          const response = await axios.post(
            'https://api.groq.com/openai/v1/audio/speech',
            {
              model: 'playai-tts',
              input: text,
              voice,
              response_format: 'mp3',
            },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              responseType: 'arraybuffer',
            },
          )

          const latencyMs = Date.now() - start
          metrics.requestCount++
          metrics.successCount++
          metrics.avgLatencyMs =
            (metrics.avgLatencyMs * (metrics.requestCount - 1) + latencyMs) / metrics.requestCount

          m.counter('xspace_tts_requests_total', 'Total TTS requests', labels)
          m.histogram('xspace_tts_latency_ms', latencyMs, 'TTS request latency', labels)
          m.histogram('xspace_tts_characters', text.length, 'Characters synthesized', labels)
          log.debug({ provider: 'groq', latencyMs, chars: text.length }, 'TTS synthesis completed')

          return Buffer.from(response.data)
        } catch (err) {
          metrics.requestCount++
          metrics.errorCount++
          m.counter('xspace_tts_requests_total', 'Total TTS requests', labels)
          m.counter('xspace_tts_errors_total', 'TTS request errors', labels)
          log.error({ err, provider: 'groq' }, 'TTS synthesis failed')
          throw err
        }
      },

      getMetrics(): ProviderMetrics {
        return { ...metrics }
      },

      estimateCost(characterCount: number): number {
        return characterCount * (TTS_PRICING['groq-tts'] ?? 0)
      },

      async checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
        const start = Date.now()
        try {
          const res = await axios.get('https://api.groq.com/openai/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 5000,
          })
          return { ok: res.status >= 200 && res.status < 300, latencyMs: Date.now() - start }
        } catch (err: any) {
          return { ok: false, latencyMs: Date.now() - start, error: err?.message ?? String(err) }
        }
      },
    }
  }

  // provider === 'openai'
  const oaiVoiceMap: Record<number, string> = {
    ...DEFAULT_OPENAI_VOICE_MAP,
    ...voiceMap,
  }
  const metrics = createTTSMetrics()
  const log = getAppLogger('tts')

  return {
    name: 'openai-tts',

    async synthesize(
      text: string,
      agentId: number = 0,
    ): Promise<Buffer | null> {
      if (!apiKey) return null
      const start = Date.now()

      const voice = oaiVoiceMap[agentId] || 'alloy'
      const m = getMetrics()
      const labels = { provider: 'openai' }

      try {
        const response = await axios.post(
          'https://api.openai.com/v1/audio/speech',
          {
            model: 'tts-1',
            input: text,
            voice,
            response_format: 'mp3',
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            responseType: 'arraybuffer',
          },
        )

        const latencyMs = Date.now() - start
        metrics.requestCount++
        metrics.successCount++
        metrics.avgLatencyMs =
          (metrics.avgLatencyMs * (metrics.requestCount - 1) + latencyMs) / metrics.requestCount

        m.counter('xspace_tts_requests_total', 'Total TTS requests', labels)
        m.histogram('xspace_tts_latency_ms', latencyMs, 'TTS request latency', labels)
        m.histogram('xspace_tts_characters', text.length, 'Characters synthesized', labels)
        log.debug({ provider: 'openai', latencyMs, chars: text.length }, 'TTS synthesis completed')

        return Buffer.from(response.data)
      } catch (err) {
        metrics.requestCount++
        metrics.errorCount++
        m.counter('xspace_tts_requests_total', 'Total TTS requests', labels)
        m.counter('xspace_tts_errors_total', 'TTS request errors', labels)
        log.error({ err, provider: 'openai' }, 'TTS synthesis failed')
        throw err
      }
    },

    getMetrics(): ProviderMetrics {
      return { ...metrics }
    },

    estimateCost(characterCount: number): number {
      return characterCount * (TTS_PRICING['openai-tts'] ?? 0)
    },

    async checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
      const start = Date.now()
      try {
        const res = await axios.get('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 5000,
        })
        return { ok: res.status >= 200 && res.status < 300, latencyMs: Date.now() - start }
      } catch (err: any) {
        return { ok: false, latencyMs: Date.now() - start, error: err?.message ?? String(err) }
      }
    },
  }
}

/**
 * Creates a TTS provider with automatic fallback.
 * If the primary provider fails, each fallback is tried in order.
 */
export function createTTSWithFallback(config: TTSConfig): TTSProvider {
  const fallbackConfigs = config.fallback
  if (!fallbackConfigs || fallbackConfigs.length === 0) {
    return createTTS(config)
  }

  const primary = createTTS({ ...config, fallback: undefined })
  const fallbacks = fallbackConfigs.map((fc) => createTTS({ ...fc, fallback: undefined }))
  const all = [primary, ...fallbacks]
  const log = getAppLogger('tts')

  return {
    name: `${primary.name}+fallback`,

    async synthesize(text: string, agentId?: number): Promise<Buffer | null> {
      for (let i = 0; i < all.length; i++) {
        const provider = all[i]
        try {
          const result = await provider.synthesize(text, agentId)
          if (result !== null) {
            if (i > 0) {
              log.warn({ provider: provider.name, attempt: i + 1 }, 'TTS succeeded on fallback provider')
            }
            return result
          }
        } catch (err) {
          log.warn(
            { err, provider: provider.name, attempt: i + 1, remaining: all.length - i - 1 },
            'TTS provider failed, trying next fallback',
          )
        }
      }
      // All providers exhausted
      log.error({ providers: all.map((p) => p.name) }, 'All TTS providers failed')
      throw new Error(`All TTS providers failed: ${all.map((p) => p.name).join(' → ')}`)
    },

    async checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
      return primary.checkHealth()
    },

    getMetrics(): ProviderMetrics {
      return primary.getMetrics()
    },

    estimateCost(characterCount: number): number {
      return primary.estimateCost(characterCount)
    },
  }
}


