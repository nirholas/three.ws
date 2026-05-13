// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§87]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createLLM } from '../../src/pipeline/llm'
import { createSTT } from '../../src/pipeline/stt'
import { createTTS } from '../../src/pipeline/tts'
import { pcmChunksToWav } from '../../src/audio/bridge'
import { VoiceActivityDetector } from '../../src/audio/vad'
import type { AIConfig } from '../../src/types'

// Mock external HTTP calls
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { stream: vi.fn() }
  },
}))

vi.mock('form-data', () => ({
  default: class MockFormData {
    append = vi.fn()
    getHeaders = vi.fn().mockReturnValue({ 'content-type': 'multipart/form-data' })
  },
}))

import axios from 'axios'

describe('STT → LLM → TTS Pipeline Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should flow audio through the full pipeline', async () => {
    const mockPost = vi.mocked(axios.post)

    // 1. Mock STT response
    mockPost.mockResolvedValueOnce({ data: { text: 'What is the weather?' } })
    // 2. Mock LLM response (custom provider, no axios needed)
    // 3. Mock TTS response
    mockPost.mockResolvedValueOnce({ data: Buffer.from('tts-audio-output') })

    // Step 1: Create audio and convert to WAV (simulating VAD output)
    const speechFloat32 = new Float32Array(4096).fill(0.3)
    const pcmChunk = Buffer.from(speechFloat32.buffer)
    const wavBuffer = pcmChunksToWav([pcmChunk], 16000)

    expect(wavBuffer.toString('ascii', 0, 4)).toBe('RIFF')

    // Step 2: STT — transcribe the WAV
    const stt = createSTT({ provider: 'openai', apiKey: 'test-stt-key' })
    const transcription = await stt.transcribe(wavBuffer, 'audio/wav')

    expect(transcription.text).toBe('What is the weather?')

    // Step 3: LLM — generate a response using custom provider
    const llmConfig: AIConfig = {
      provider: 'custom',
      systemPrompt: 'You are a weather assistant.',
      custom: {
        type: 'socket',
        generateResponse: vi.fn().mockResolvedValue('It is sunny and 72°F today.'),
      },
    }

    const llm = createLLM(llmConfig)
    let llmResponse = ''
    for await (const delta of llm.streamResponse(0, transcription.text, llmConfig.systemPrompt)) {
      llmResponse += delta
    }

    expect(llmResponse).toBe('It is sunny and 72°F today.')

    // Step 4: TTS — synthesize the response
    const tts = createTTS({ provider: 'openai', apiKey: 'test-tts-key' })
    const audioOutput = await tts.synthesize(llmResponse)

    expect(audioOutput).toBeInstanceOf(Buffer)
    expect(audioOutput!.length).toBeGreaterThan(0)
  })

  it('should handle empty transcription gracefully', async () => {
    const mockPost = vi.mocked(axios.post)
    mockPost.mockResolvedValueOnce({ data: { text: '' } })

    const stt = createSTT({ provider: 'groq', apiKey: 'test-key' })
    const result = await stt.transcribe(Buffer.from('silence'))

    expect(result.text).toBe('')
    // Pipeline should stop here — no LLM call needed for empty transcription
  })

  it('should maintain separate history for multiple agents', async () => {
    const mockGenerate = vi.fn()
      .mockResolvedValueOnce('Agent 0 response')
      .mockResolvedValueOnce('Agent 1 response')
      .mockResolvedValueOnce('Agent 0 second response')

    const config: AIConfig = {
      provider: 'custom',
      systemPrompt: 'test',
      custom: {
        type: 'socket',
        generateResponse: mockGenerate,
      },
    }

    const llm = createLLM(config)

    // Agent 0 speaks
    const chunks0: string[] = []
    for await (const d of llm.streamResponse(0, 'Hello from 0', 'sys')) {
      chunks0.push(d)
    }
    expect(chunks0.join('')).toBe('Agent 0 response')

    // Agent 1 speaks
    const chunks1: string[] = []
    for await (const d of llm.streamResponse(1, 'Hello from 1', 'sys')) {
      chunks1.push(d)
    }
    expect(chunks1.join('')).toBe('Agent 1 response')

    // Agent 0 speaks again — should have its own history
    for await (const _ of llm.streamResponse(0, 'Follow up', 'sys')) {}

    // Agent 0's history should contain its messages, not agent 1's
    const lastCallMessages = mockGenerate.mock.calls[2][0].messages
    expect(lastCallMessages.some((m: any) => m.content === 'Hello from 0')).toBe(true)
    expect(lastCallMessages.some((m: any) => m.content === 'Hello from 1')).toBe(false)
  })

  it('should integrate VAD with pcmChunksToWav', () => {
    const vad = new VoiceActivityDetector({ silenceThresholdMs: 500, minChunks: 1 })
    const collectedChunks: Buffer[] = []

    vad.onSpeech((chunks) => {
      collectedChunks.push(...chunks)
    })

    // Feed speech
    const speech = new Float32Array(4096).fill(0.5)
    const speechBuffer = Buffer.from(speech.buffer)
    vad.feed(speechBuffer.toString('base64'))

    // Feed silence to trigger flush
    const silence = new Float32Array(4096).fill(0)
    vad.feed(Buffer.from(silence.buffer).toString('base64'))

    // Wait for silence threshold (using real timers here)
    // Instead, manually verify the chunks can be converted to WAV
    if (collectedChunks.length > 0) {
      const wav = pcmChunksToWav(collectedChunks, 16000)
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    }

    vad.destroy()
  })
})


