// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSTT } from '../../../src/pipeline/stt'

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}))

vi.mock('form-data', () => {
  return {
    default: class MockFormData {
      append = vi.fn()
      getHeaders = vi.fn().mockReturnValue({ 'content-type': 'multipart/form-data' })
    },
  }
})

import axios from 'axios'

describe('createSTT', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create an OpenAI STT provider', () => {
    const stt = createSTT({ provider: 'openai', apiKey: 'test-key' })
    expect(stt).toBeDefined()
    expect(stt.transcribe).toBeTypeOf('function')
  })

  it('should create a Groq STT provider', () => {
    const stt = createSTT({ provider: 'groq', apiKey: 'test-key' })
    expect(stt).toBeDefined()
    expect(stt.transcribe).toBeTypeOf('function')
  })

  it('should call OpenAI API for transcription', async () => {
    const mockPost = vi.mocked(axios.post)
    mockPost.mockResolvedValue({ data: { text: 'Hello world' } })

    const stt = createSTT({ provider: 'openai', apiKey: 'test-key' })
    const result = await stt.transcribe(Buffer.from('audio-data'), 'audio/wav')

    expect(result).toEqual({ text: 'Hello world' })
    expect(mockPost).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    )
  })

  it('should call Groq API for transcription', async () => {
    const mockPost = vi.mocked(axios.post)
    mockPost.mockResolvedValue({ data: { text: 'Groq transcription' } })

    const stt = createSTT({ provider: 'groq', apiKey: 'groq-key' })
    const result = await stt.transcribe(Buffer.from('audio-data'))

    expect(result).toEqual({ text: 'Groq transcription' })
    expect(mockPost).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.anything(),
      expect.anything(),
    )
  })

  it('should return empty string when API returns no text', async () => {
    const mockPost = vi.mocked(axios.post)
    mockPost.mockResolvedValue({ data: { text: '' } })

    const stt = createSTT({ provider: 'openai', apiKey: 'test-key' })
    const result = await stt.transcribe(Buffer.from('silence'))

    expect(result).toEqual({ text: '' })
  })
})


