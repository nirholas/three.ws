// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { describe, it, expect } from 'vitest'
import { createLLM } from '../../pipeline/llm'

const hasOpenAI = !!process.env.OPENAI_API_KEY
const hasClaude = !!process.env.ANTHROPIC_API_KEY
const hasGroq = !!process.env.GROQ_API_KEY

async function collectStream(stream: AsyncIterable<string>): Promise<string> {
  let result = ''
  for await (const chunk of stream) {
    result += chunk
  }
  return result
}

describe.skipIf(!hasOpenAI)('OpenAI LLM E2E', () => {
  const llm = createLLM({
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    systemPrompt: 'You are a helpful assistant. Reply in one short sentence.',
    maxTokens: 100,
  })

  it('should stream a response from OpenAI', async () => {
    const response = await collectStream(
      llm.streamResponse(0, 'Say hello in exactly three words.', 'You are a helpful assistant. Reply in one short sentence.'),
    )

    expect(response).toBeTruthy()
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
  }, 30_000)

  it('should return valid metrics after a request', () => {
    const metrics = llm.getMetrics?.()
    expect(metrics).toBeDefined()
    expect(metrics!.requestCount).toBeGreaterThanOrEqual(1)
    expect(metrics!.successCount).toBeGreaterThanOrEqual(1)
  })

  it('should pass a health check', async () => {
    const health = await llm.checkHealth?.()
    expect(health).toBeDefined()
    expect(health!.ok).toBe(true)
    expect(health!.latencyMs).toBeGreaterThan(0)
  }, 15_000)
})

describe.skipIf(!hasClaude)('Claude LLM E2E', () => {
  const llm = createLLM({
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    systemPrompt: 'You are a helpful assistant. Reply in one short sentence.',
    maxTokens: 100,
  })

  it('should stream a response from Claude', async () => {
    const response = await collectStream(
      llm.streamResponse(0, 'Say hello in exactly three words.', 'You are a helpful assistant. Reply in one short sentence.'),
    )

    expect(response).toBeTruthy()
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
  }, 30_000)

  it('should return valid metrics after a request', () => {
    const metrics = llm.getMetrics?.()
    expect(metrics).toBeDefined()
    expect(metrics!.requestCount).toBeGreaterThanOrEqual(1)
    expect(metrics!.successCount).toBeGreaterThanOrEqual(1)
  })

  it('should pass a health check', async () => {
    const health = await llm.checkHealth?.()
    expect(health).toBeDefined()
    expect(health!.ok).toBe(true)
    expect(health!.latencyMs).toBeGreaterThan(0)
  }, 15_000)
})

describe.skipIf(!hasGroq)('Groq LLM E2E', () => {
  const llm = createLLM({
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY,
    systemPrompt: 'You are a helpful assistant. Reply in one short sentence.',
    maxTokens: 100,
  })

  it('should stream a response from Groq', async () => {
    const response = await collectStream(
      llm.streamResponse(0, 'Say hello in exactly three words.', 'You are a helpful assistant. Reply in one short sentence.'),
    )

    expect(response).toBeTruthy()
    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
  }, 30_000)

  it('should return valid metrics after a request', () => {
    const metrics = llm.getMetrics?.()
    expect(metrics).toBeDefined()
    expect(metrics!.requestCount).toBeGreaterThanOrEqual(1)
    expect(metrics!.successCount).toBeGreaterThanOrEqual(1)
  })

  it('should pass a health check', async () => {
    const health = await llm.checkHealth?.()
    expect(health).toBeDefined()
    expect(health!.ok).toBe(true)
    expect(health!.latencyMs).toBeGreaterThan(0)
  }, 15_000)
})


