// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§87]

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createSTT } from '../../pipeline/stt'

const hasOpenAI = !!process.env.OPENAI_API_KEY
const hasGroq = !!process.env.GROQ_API_KEY

const fixturesDir = path.join(__dirname, '..', 'fixtures')
const helloWav = fs.existsSync(path.join(fixturesDir, 'hello.wav'))
  ? fs.readFileSync(path.join(fixturesDir, 'hello.wav'))
  : null
const silenceWav = fs.existsSync(path.join(fixturesDir, 'silence.wav'))
  ? fs.readFileSync(path.join(fixturesDir, 'silence.wav'))
  : null

describe.skipIf(!hasOpenAI)('OpenAI STT E2E', () => {
  const stt = createSTT({
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })

  it('should transcribe audio from a WAV file', async () => {
    expect(helloWav).not.toBeNull()
    const result = await stt.transcribe(helloWav!, 'audio/wav')

    expect(result).toBeDefined()
    expect(typeof result.text).toBe('string')
    // The synthetic tone may or may not produce meaningful text,
    // but the API should return a valid response
    expect(result).toHaveProperty('text')
  }, 30_000)

  it('should handle silence gracefully', async () => {
    expect(silenceWav).not.toBeNull()
    const result = await stt.transcribe(silenceWav!, 'audio/wav')

    expect(result).toBeDefined()
    expect(typeof result.text).toBe('string')
    // Silence should produce empty or very short transcription
    expect(result.text.length).toBeLessThan(50)
  }, 30_000)
})

describe.skipIf(!hasGroq)('Groq STT E2E', () => {
  const stt = createSTT({
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY!,
  })

  it('should transcribe audio from a WAV file', async () => {
    expect(helloWav).not.toBeNull()
    const result = await stt.transcribe(helloWav!, 'audio/wav')

    expect(result).toBeDefined()
    expect(typeof result.text).toBe('string')
    expect(result).toHaveProperty('text')
  }, 30_000)

  it('should handle silence gracefully', async () => {
    expect(silenceWav).not.toBeNull()
    const result = await stt.transcribe(silenceWav!, 'audio/wav')

    expect(result).toBeDefined()
    expect(typeof result.text).toBe('string')
    expect(result.text.length).toBeLessThan(50)
  }, 30_000)
})


