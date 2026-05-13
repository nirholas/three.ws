// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElevenLabsCloningProvider } from '../../../src/voice/cloning-provider'
import type { AudioSample } from '../../../src/voice/types'

vi.mock('axios', () => {
  const axiosFn: any = vi.fn().mockResolvedValue({ data: { voices: [] } })
  axiosFn.post = vi.fn()
  axiosFn.get = vi.fn()
  return { default: axiosFn }
})

vi.mock('form-data', () => ({
  default: class MockFormData {
    append = vi.fn()
    getHeaders = vi.fn().mockReturnValue({ 'content-type': 'multipart/form-data' })
  },
}))

import axios from 'axios'

describe('ElevenLabs Cloning Provider', () => {
  let provider: ReturnType<typeof createElevenLabsCloningProvider>

  beforeEach(() => {
    vi.clearAllMocks()
    provider = createElevenLabsCloningProvider('test-el-key')
  })

  describe('cloneVoice', () => {
    it('should clone a voice from audio samples', async () => {
      const mockPost = vi.mocked(axios.post)
      mockPost.mockResolvedValueOnce({ data: { voice_id: 'el-voice-abc' } })

      const samples: AudioSample[] = [
        {
          audioBuffer: Buffer.from('fake-audio'),
          format: 'wav',
          durationSeconds: 90,
          transcript: 'Test transcript',
        },
      ]

      const result = await provider.cloneVoice(samples, 'My Voice', 'A cloned voice')
      expect(result.providerVoiceId).toBe('el-voice-abc')
      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining('/voices/add'),
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'xi-api-key': 'test-el-key',
          }),
        }),
      )
    })
  })

  describe('designVoice', () => {
    it('should design a voice from description', async () => {
      const mockAxios = vi.mocked(axios)
      mockAxios.mockResolvedValueOnce({
        data: { voice_id: 'el-designed-123' },
      })

      const result = await provider.designVoice({
        description: 'A warm professional female voice',
        gender: 'female',
        age: 'middle',
        style: 'professional',
      })

      expect(result.providerVoiceId).toBe('el-designed-123')
      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'post',
          url: expect.stringContaining('/voice-generation/generate-voice'),
          data: expect.objectContaining({
            gender: 'female',
            age: 'middle_aged',
          }),
        }),
      )
    })
  })

  describe('deleteVoice', () => {
    it('should delete a voice from ElevenLabs', async () => {
      const mockAxios = vi.mocked(axios)
      mockAxios.mockResolvedValueOnce({ data: {} })

      await provider.deleteVoice('el-voice-to-delete')

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'delete',
          url: expect.stringContaining('/voices/el-voice-to-delete'),
        }),
      )
    })
  })

  describe('previewVoice', () => {
    it('should generate a preview', async () => {
      const audioData = Buffer.from('preview-audio-data')
      const mockAxios = vi.mocked(axios)
      mockAxios.mockResolvedValueOnce({ data: audioData })

      const preview = await provider.previewVoice('el-voice-123', 'Hello world')

      expect(preview.audioBuffer).toBeInstanceOf(Buffer)
      expect(preview.format).toBe('mp3')
      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'post',
          url: expect.stringContaining('/text-to-speech/el-voice-123'),
        }),
      )
    })
  })

  describe('listProviderVoices', () => {
    it('should list available voices', async () => {
      const mockAxios = vi.mocked(axios)
      mockAxios.mockResolvedValueOnce({
        data: {
          voices: [
            { voice_id: 'v1', name: 'Voice One' },
            { voice_id: 'v2', name: 'Voice Two' },
          ],
        },
      })

      const voices = await provider.listProviderVoices()
      expect(voices).toHaveLength(2)
      expect(voices[0]).toEqual({ id: 'v1', name: 'Voice One' })
    })
  })

  describe('checkHealth', () => {
    it('should return ok on success', async () => {
      const mockAxios = vi.mocked(axios)
      mockAxios.mockResolvedValueOnce({ data: { voices: [] } })

      const health = await provider.checkHealth()
      expect(health.ok).toBe(true)
      expect(health.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('should return error on failure', async () => {
      const mockAxios = vi.mocked(axios)
      mockAxios.mockRejectedValueOnce(new Error('Network error'))

      const health = await provider.checkHealth()
      expect(health.ok).toBe(false)
      expect(health.error).toBe('Network error')
    })
  })
})


