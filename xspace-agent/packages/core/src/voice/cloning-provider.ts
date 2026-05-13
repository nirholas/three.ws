// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// Voice Cloning Provider — ElevenLabs Implementation
// =============================================================================

import axios from 'axios'
import { getAppLogger } from '../observability/logger'
import type {
  AudioSample,
  Voice,
  VoiceDesignParams,
  VoicePreview,
  VoiceSettings,
} from './types'

const log = getAppLogger('voice-cloning')

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1'

/**
 * Interface for a voice cloning provider backend.
 */
export interface VoiceCloningProvider {
  readonly name: string

  /**
   * Clone a voice from audio samples (instant clone).
   * Returns the provider-specific voice ID.
   */
  cloneVoice(
    samples: AudioSample[],
    name: string,
    description: string,
  ): Promise<{ providerVoiceId: string }>

  /**
   * Design a voice from a text description (no samples needed).
   * Returns the provider-specific voice ID.
   */
  designVoice(params: VoiceDesignParams): Promise<{ providerVoiceId: string }>

  /** Delete a cloned voice from the provider. */
  deleteVoice(providerVoiceId: string): Promise<void>

  /** Update voice settings on the provider side. */
  updateVoiceSettings(providerVoiceId: string, settings: Partial<VoiceSettings>): Promise<void>

  /** Generate a preview of a voice. */
  previewVoice(providerVoiceId: string, text: string): Promise<VoicePreview>

  /** List all voices available on the provider account. */
  listProviderVoices(): Promise<Array<{ id: string; name: string }>>

  /** Check provider connectivity. */
  checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }>
}

/**
 * ElevenLabs voice cloning provider.
 *
 * Supports:
 * - Instant Voice Clone (1+ minute of audio)
 * - Voice Design from text description
 * - Voice preview generation
 */
export function createElevenLabsCloningProvider(apiKey: string): VoiceCloningProvider {
  async function apiRequest<T>(
    method: 'get' | 'post' | 'delete',
    path: string,
    data?: any,
    headers?: Record<string, string>,
    responseType?: 'arraybuffer' | 'json',
  ): Promise<T> {
    const response = await axios({
      method,
      url: `${ELEVENLABS_API}${path}`,
      data,
      headers: {
        'xi-api-key': apiKey,
        ...headers,
      },
      responseType: responseType ?? 'json',
    })
    return response.data as T
  }

  return {
    name: 'elevenlabs',

    async cloneVoice(
      samples: AudioSample[],
      name: string,
      description: string,
    ): Promise<{ providerVoiceId: string }> {
      // ElevenLabs instant voice clone uses multipart form data
      const FormData = (await import('form-data')).default
      const form = new FormData()
      form.append('name', name)
      form.append('description', description)

      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i]
        const filename = `sample_${i}.${sample.format}`
        form.append('files', sample.audioBuffer, {
          filename,
          contentType: sample.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
        })
      }

      log.info({ name, sampleCount: samples.length }, 'Creating voice clone via ElevenLabs')

      const response = await axios.post(
        `${ELEVENLABS_API}/voices/add`,
        form,
        {
          headers: {
            'xi-api-key': apiKey,
            ...form.getHeaders(),
          },
        },
      )

      const voiceId = response.data.voice_id as string
      log.info({ voiceId, name }, 'Voice clone created')
      return { providerVoiceId: voiceId }
    },

    async designVoice(params: VoiceDesignParams): Promise<{ providerVoiceId: string }> {
      // Map our gender/age/style to ElevenLabs voice design parameters
      const genderMap: Record<string, string> = {
        male: 'male',
        female: 'female',
        neutral: 'neutral',
      }
      const ageMap: Record<string, string> = {
        young: 'young',
        middle: 'middle_aged',
        senior: 'old',
      }

      log.info({ description: params.description, gender: params.gender }, 'Designing voice via ElevenLabs')

      const response = await apiRequest<{ voice_id: string }>('post', '/voice-generation/generate-voice', {
        gender: genderMap[params.gender] ?? 'neutral',
        age: ageMap[params.age] ?? 'middle_aged',
        accent: params.accent ?? 'american',
        accent_strength: 1.0,
        text: params.description,
      })

      log.info({ voiceId: response.voice_id }, 'Voice designed')
      return { providerVoiceId: response.voice_id }
    },

    async deleteVoice(providerVoiceId: string): Promise<void> {
      log.info({ voiceId: providerVoiceId }, 'Deleting voice from ElevenLabs')
      await apiRequest('delete', `/voices/${providerVoiceId}`)
    },

    async updateVoiceSettings(providerVoiceId: string, settings: Partial<VoiceSettings>): Promise<void> {
      const body: Record<string, number> = {}
      if (settings.stability !== undefined) body.stability = settings.stability
      if (settings.similarityBoost !== undefined) body.similarity_boost = settings.similarityBoost
      if (settings.style !== undefined) body.style = settings.style

      if (Object.keys(body).length > 0) {
        await apiRequest('post', `/voices/${providerVoiceId}/settings/edit`, body)
        log.debug({ voiceId: providerVoiceId, settings: body }, 'Voice settings updated')
      }
    },

    async previewVoice(providerVoiceId: string, text: string): Promise<VoicePreview> {
      const audioData = await apiRequest<ArrayBuffer>(
        'post',
        `/text-to-speech/${providerVoiceId}`,
        {
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0.0,
            use_speaker_boost: true,
          },
        },
        {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
        },
        'arraybuffer',
      )

      const buffer = Buffer.from(audioData)
      // Rough duration estimate: MP3 at ~128kbps = 16KB/s
      const estimatedDuration = buffer.length / 16000

      return {
        audioBuffer: buffer,
        durationSeconds: estimatedDuration,
        format: 'mp3',
      }
    },

    async listProviderVoices(): Promise<Array<{ id: string; name: string }>> {
      const response = await apiRequest<{ voices: Array<{ voice_id: string; name: string }> }>(
        'get',
        '/voices',
      )
      return response.voices.map((v) => ({ id: v.voice_id, name: v.name }))
    },

    async checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
      const start = Date.now()
      try {
        await apiRequest('get', '/voices')
        return { ok: true, latencyMs: Date.now() - start }
      } catch (err: any) {
        return { ok: false, latencyMs: Date.now() - start, error: err?.message ?? String(err) }
      }
    },
  }
}


