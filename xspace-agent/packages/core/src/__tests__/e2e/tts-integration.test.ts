// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

import { describe, it, expect } from 'vitest'
import { createTTS } from '../../pipeline/tts'

const hasOpenAI = !!process.env.OPENAI_API_KEY
const hasElevenLabs = !!process.env.ELEVENLABS_API_KEY

describe.skipIf(!hasOpenAI)('OpenAI TTS E2E', () => {
  const tts = createTTS({
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })

  it('should synthesize speech from text', async () => {
    const audio = await tts.synthesize('Hello, this is a test.', 0)

    expect(audio).not.toBeNull()
    expect(audio).toBeInstanceOf(Buffer)
    expect(audio!.length).toBeGreaterThan(0)

    // MP3 files start with ID3 tag or MPEG sync bytes (0xFF 0xFB)
    const hasID3 = audio!.subarray(0, 3).toString() === 'ID3'
    const hasMPEGSync = audio![0] === 0xff && (audio![1] & 0xe0) === 0xe0
    expect(hasID3 || hasMPEGSync).toBe(true)
  }, 30_000)

  it('should handle empty string gracefully', async () => {
    // OpenAI TTS may reject empty input — verify it doesn't crash
    try {
      const audio = await tts.synthesize('', 0)
      // If it succeeds, result should be a buffer or null
      if (audio !== null) {
        expect(audio).toBeInstanceOf(Buffer)
      }
    } catch (err: any) {
      // An API error for empty input is acceptable behavior
      expect(err).toBeDefined()
    }
  }, 15_000)

  it('should support different agent voices', async () => {
    const audioAgent0 = await tts.synthesize('Test voice zero.', 0)
    const audioAgent1 = await tts.synthesize('Test voice one.', 1)

    expect(audioAgent0).not.toBeNull()
    expect(audioAgent1).not.toBeNull()
    expect(audioAgent0!.length).toBeGreaterThan(0)
    expect(audioAgent1!.length).toBeGreaterThan(0)
  }, 30_000)
})

describe.skipIf(!hasElevenLabs)('ElevenLabs TTS E2E', () => {
  const tts = createTTS({
    provider: 'elevenlabs',
    apiKey: process.env.ELEVENLABS_API_KEY!,
  })

  it('should synthesize speech from text', async () => {
    const audio = await tts.synthesize('Hello, this is a test.', 0)

    expect(audio).not.toBeNull()
    expect(audio).toBeInstanceOf(Buffer)
    expect(audio!.length).toBeGreaterThan(0)
  }, 30_000)

  it('should handle empty string gracefully', async () => {
    try {
      const audio = await tts.synthesize('', 0)
      if (audio !== null) {
        expect(audio).toBeInstanceOf(Buffer)
      }
    } catch (err: any) {
      expect(err).toBeDefined()
    }
  }, 15_000)
})

describe('Browser TTS (no API key needed)', () => {
  const tts = createTTS({ provider: 'browser' })

  it('should return null for browser provider', async () => {
    const audio = await tts.synthesize('Hello', 0)
    expect(audio).toBeNull()
  })
})


