// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTTS } from '../../../src/pipeline/tts'

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}))

import axios from 'axios'

describe('createTTS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('browser provider', () => {
    it('should return null for browser TTS', async () => {
      const tts = createTTS({ provider: 'browser' })
      const result = await tts.synthesize('Hello')
      expect(result).toBeNull()
    })
  })

  describe('OpenAI provider', () => {
    it('should call OpenAI API', async () => {
      const mockAudio = Buffer.from('fake-audio-data')
      const mockPost = vi.mocked(axios.post)
      mockPost.mockResolvedValue({ data: mockAudio })

      const tts = createTTS({ provider: 'openai', apiKey: 'test-key' })
      const result = await tts.synthesize('Hello world')

      expect(result).toBeInstanceOf(Buffer)
      expect(mockPost).toHaveBeenCalledWith(
        'https://api.openai.com/v1/audio/speech',
        expect.objectContaining({
          model: 'tts-1',
          input: 'Hello world',
          voice: 'onyx',
          response_format: 'mp3',
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
        }),
      )
    })

    it('should return null without API key', async () => {
      const tts = createTTS({ provider: 'openai' })
      const result = await tts.synthesize('Hello')
      expect(result).toBeNull()
    })

    it('should use per-agent voice mapping', async () => {
      const mockPost = vi.mocked(axios.post)
      mockPost.mockResolvedValue({ data: Buffer.from('audio') })

      const tts = createTTS({
        provider: 'openai',
        apiKey: 'key',
        voiceMap: { 0: 'echo', 1: 'fable' },
      })

      await tts.synthesize('Hello', 0)
      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ voice: 'echo' }),
        expect.anything(),
      )

      await tts.synthesize('Hello', 1)
      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ voice: 'fable' }),
        expect.anything(),
      )
    })

    it('should fall back to alloy for unknown agent IDs', async () => {
      const mockPost = vi.mocked(axios.post)
      mockPost.mockResolvedValue({ data: Buffer.from('audio') })

      const tts = createTTS({ provider: 'openai', apiKey: 'key' })
      await tts.synthesize('Hello', 99)

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ voice: 'alloy' }),
        expect.anything(),
      )
    })
  })

  describe('ElevenLabs provider', () => {
    it('should call ElevenLabs API', async () => {
      const mockPost = vi.mocked(axios.post)
      mockPost.mockResolvedValue({ data: Buffer.from('audio') })

      const tts = createTTS({ provider: 'elevenlabs', apiKey: 'el-key' })
      const result = await tts.synthesize('Hello')

      expect(result).toBeInstanceOf(Buffer)
      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining('api.elevenlabs.io'),
        expect.objectContaining({
          text: 'Hello',
          model_id: 'eleven_multilingual_v2',
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'xi-api-key': 'el-key',
          }),
        }),
      )
    })

    it('should return null without API key', async () => {
      const tts = createTTS({ provider: 'elevenlabs' })
      const result = await tts.synthesize('Hello')
      expect(result).toBeNull()
    })

    it('should use custom voice map for ElevenLabs', async () => {
      const mockPost = vi.mocked(axios.post)
      mockPost.mockResolvedValue({ data: Buffer.from('audio') })

      const tts = createTTS({
        provider: 'elevenlabs',
        apiKey: 'key',
        voiceMap: { 0: 'custom-voice-id' },
      })

      await tts.synthesize('Hello', 0)
      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining('custom-voice-id'),
        expect.anything(),
        expect.anything(),
      )
    })
  })
})


