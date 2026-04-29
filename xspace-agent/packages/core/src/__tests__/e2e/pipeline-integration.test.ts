// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createLLM } from '../../pipeline/llm'
import { createSTT } from '../../pipeline/stt'
import { createTTS } from '../../pipeline/tts'

const hasOpenAI = !!process.env.OPENAI_API_KEY
const hasClaude = !!process.env.ANTHROPIC_API_KEY

const fixturesDir = path.join(__dirname, '..', 'fixtures')
const helloWav = fs.existsSync(path.join(fixturesDir, 'hello.wav'))
  ? fs.readFileSync(path.join(fixturesDir, 'hello.wav'))
  : null

describe.skipIf(!hasOpenAI)('Full Pipeline E2E (OpenAI)', () => {
  it('should complete audio → STT → LLM → TTS → audio', async () => {
    expect(helloWav).not.toBeNull()

    // Step 1: STT — transcribe audio
    const stt = createSTT({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
    })
    const transcription = await stt.transcribe(helloWav!, 'audio/wav')
    expect(transcription).toBeDefined()
    expect(typeof transcription.text).toBe('string')

    // Step 2: LLM — generate response from transcription
    const llm = createLLM({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      systemPrompt: 'You are a friendly assistant. Reply in one short sentence.',
      maxTokens: 100,
    })

    const inputText = transcription.text || 'Hello'
    let llmResponse = ''
    for await (const chunk of llm.streamResponse(0, inputText, 'You are a friendly assistant. Reply in one short sentence.')) {
      llmResponse += chunk
    }
    expect(llmResponse).toBeTruthy()
    expect(llmResponse.length).toBeGreaterThan(0)

    // Step 3: TTS — synthesize response to audio
    const tts = createTTS({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
    })
    const audioOutput = await tts.synthesize(llmResponse, 0)
    expect(audioOutput).not.toBeNull()
    expect(audioOutput).toBeInstanceOf(Buffer)
    expect(audioOutput!.length).toBeGreaterThan(0)
  }, 60_000)
})

describe.skipIf(!hasClaude || !hasOpenAI)('Full Pipeline E2E (Claude LLM + OpenAI STT/TTS)', () => {
  it('should complete audio → STT → LLM → TTS → audio', async () => {
    expect(helloWav).not.toBeNull()

    // Step 1: STT (OpenAI Whisper)
    const stt = createSTT({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
    })
    const transcription = await stt.transcribe(helloWav!, 'audio/wav')
    expect(transcription).toBeDefined()

    // Step 2: LLM (Claude)
    const llm = createLLM({
      provider: 'claude',
      apiKey: process.env.ANTHROPIC_API_KEY,
      systemPrompt: 'You are a friendly assistant. Reply in one short sentence.',
      maxTokens: 100,
    })

    const inputText = transcription.text || 'Hello'
    let llmResponse = ''
    for await (const chunk of llm.streamResponse(0, inputText, 'You are a friendly assistant. Reply in one short sentence.')) {
      llmResponse += chunk
    }
    expect(llmResponse).toBeTruthy()

    // Step 3: TTS (OpenAI)
    const tts = createTTS({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
    })
    const audioOutput = await tts.synthesize(llmResponse, 0)
    expect(audioOutput).not.toBeNull()
    expect(audioOutput!.length).toBeGreaterThan(0)
  }, 60_000)
})


