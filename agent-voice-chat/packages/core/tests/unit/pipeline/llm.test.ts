// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

import { describe, it, expect, vi } from 'vitest'
import { createLLM } from '../../../src/pipeline/llm'
import type { AIConfig } from '../../../src/types'

// Mock external dependencies
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { stream: vi.fn() }
    },
  }
})

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}))

describe('createLLM', () => {
  it('should create a Claude provider', () => {
    const config: AIConfig = {
      provider: 'claude',
      apiKey: 'test-key',
      systemPrompt: 'You are helpful.',
    }

    const llm = createLLM(config)
    expect(llm).toBeDefined()
    expect(llm.type).toBe('socket')
    expect(llm.streamResponse).toBeTypeOf('function')
    expect(llm.clearHistory).toBeTypeOf('function')
  })

  it('should create a Groq provider', () => {
    const config: AIConfig = {
      provider: 'groq',
      apiKey: 'test-key',
      systemPrompt: 'You are helpful.',
    }

    const llm = createLLM(config)
    expect(llm).toBeDefined()
    expect(llm.type).toBe('socket')
  })

  it('should create an OpenAI provider', () => {
    const config: AIConfig = {
      provider: 'openai',
      apiKey: 'test-key',
      systemPrompt: 'You are helpful.',
    }

    const llm = createLLM(config)
    expect(llm).toBeDefined()
    expect(llm.type).toBe('socket')
  })

  it('should create a custom provider', () => {
    const config: AIConfig = {
      provider: 'custom',
      systemPrompt: 'You are helpful.',
      custom: {
        type: 'socket',
        generateResponse: vi.fn().mockResolvedValue('Hello!'),
      },
    }

    const llm = createLLM(config)
    expect(llm).toBeDefined()
    expect(llm.type).toBe('socket')
  })

  it('should throw for unsupported providers', () => {
    const config = {
      provider: 'unknown-provider',
      systemPrompt: 'test',
    } as unknown as AIConfig

    expect(() => createLLM(config)).toThrow('Unsupported LLM provider')
  })
})

describe('Custom LLM provider', () => {
  it('should delegate to custom generateResponse', async () => {
    const mockGenerate = vi.fn().mockResolvedValue('Custom response')
    const config: AIConfig = {
      provider: 'custom',
      systemPrompt: 'You are helpful.',
      custom: {
        type: 'socket',
        generateResponse: mockGenerate,
      },
    }

    const llm = createLLM(config)
    const chunks: string[] = []

    for await (const delta of llm.streamResponse(0, 'Hello', 'System prompt')) {
      chunks.push(delta)
    }

    expect(chunks).toEqual(['Custom response'])
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'System prompt',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Hello' }),
        ]),
      }),
    )
  })

  it('should delegate to custom generateResponseStream when available', async () => {
    async function* mockStream() {
      yield 'chunk1'
      yield 'chunk2'
      yield 'chunk3'
    }

    const config: AIConfig = {
      provider: 'custom',
      systemPrompt: 'test',
      custom: {
        type: 'socket',
        generateResponse: vi.fn(),
        generateResponseStream: () => mockStream(),
      },
    }

    const llm = createLLM(config)
    const chunks: string[] = []

    for await (const delta of llm.streamResponse(0, 'Hello', 'System')) {
      chunks.push(delta)
    }

    expect(chunks).toEqual(['chunk1', 'chunk2', 'chunk3'])
  })

  it('should maintain conversation history per agent', async () => {
    let callCount = 0
    const mockGenerate = vi.fn().mockImplementation(({ messages }) => {
      callCount++
      return Promise.resolve(`Response ${callCount}`)
    })

    const config: AIConfig = {
      provider: 'custom',
      systemPrompt: 'test',
      maxHistory: 4,
      custom: {
        type: 'socket',
        generateResponse: mockGenerate,
      },
    }

    const llm = createLLM(config)

    // First message for agent 0
    for await (const _ of llm.streamResponse(0, 'msg1', 'sys')) {}

    // Second message for agent 0
    for await (const _ of llm.streamResponse(0, 'msg2', 'sys')) {}

    // The second call should include history from the first
    const lastCall = mockGenerate.mock.calls[1][0]
    expect(lastCall.messages).toHaveLength(4) // user1, assistant1, user2
    // Actually: user1, assistant1, user2 = 3, but maxHistory=4 so none are trimmed
    // Wait, the custom provider pushes user before calling, so:
    // After first call: [user:msg1, assistant:Response1]
    // Before second call generates: [user:msg1, assistant:Response1, user:msg2]
    expect(lastCall.messages[0]).toEqual({ role: 'user', content: 'msg1' })
    expect(lastCall.messages[1]).toEqual({ role: 'assistant', content: 'Response 1' })
    expect(lastCall.messages[2]).toEqual({ role: 'user', content: 'msg2' })
  })

  it('should clear history', async () => {
    // Capture messages snapshot at call time since the array is mutated after
    const capturedMessages: any[][] = []
    const mockGenerate = vi.fn().mockImplementation(({ messages }) => {
      capturedMessages.push([...messages])
      return Promise.resolve('ok')
    })
    const config: AIConfig = {
      provider: 'custom',
      systemPrompt: 'test',
      custom: {
        type: 'socket',
        generateResponse: mockGenerate,
      },
    }

    const llm = createLLM(config)
    for await (const _ of llm.streamResponse(0, 'msg1', 'sys')) {}

    llm.clearHistory!(0)

    for await (const _ of llm.streamResponse(0, 'msg2', 'sys')) {}

    // After clearing, second call should only have the new message
    expect(capturedMessages[1]).toHaveLength(1)
    expect(capturedMessages[1][0]).toEqual({ role: 'user', content: 'msg2' })
  })

  it('should enforce maxHistory limit', async () => {
    const capturedMessages: any[][] = []
    const mockGenerate = vi.fn().mockImplementation(({ messages }) => {
      capturedMessages.push([...messages])
      return Promise.resolve('ok')
    })
    const config: AIConfig = {
      provider: 'custom',
      systemPrompt: 'test',
      maxHistory: 4,
      custom: {
        type: 'socket',
        generateResponse: mockGenerate,
      },
    }

    const llm = createLLM(config)

    // Send enough messages to exceed maxHistory
    for (let i = 0; i < 5; i++) {
      for await (const _ of llm.streamResponse(0, `msg${i}`, 'sys')) {}
    }

    // Last call should have at most maxHistory messages
    expect(capturedMessages[4].length).toBeLessThanOrEqual(4)
  })
})


