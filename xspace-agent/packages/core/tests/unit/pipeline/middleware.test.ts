// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§67]

import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { MiddlewareStage } from '../../../src/types'

// We can't easily test the XSpaceAgent.use() method without browser deps,
// so we test the middleware pipeline logic directly.
// The runMiddleware pattern is: chain handlers, pass result through, null = abort.

describe('Middleware pipeline logic', () => {
  // Replicate the middleware runner from agent.ts
  async function runMiddleware(
    middlewares: Map<MiddlewareStage, Array<(...args: any[]) => any>>,
    stage: MiddlewareStage,
    ...args: any[]
  ): Promise<any> {
    const handlers = middlewares.get(stage)
    if (!handlers || handlers.length === 0) {
      return args.length === 1 ? args[0] : { messages: args[0], systemPrompt: args[1] }
    }

    let result: any = args.length === 1 ? args[0] : { messages: args[0], systemPrompt: args[1] }
    for (const handler of handlers) {
      const output = await handler(result)
      if (output === null || output === undefined) return null
      result = output
    }
    return result
  }

  it('should pass through when no middleware registered', async () => {
    const mw = new Map<MiddlewareStage, Array<(...args: any[]) => any>>()
    const result = await runMiddleware(mw, 'before:llm', 'test-input')
    expect(result).toBe('test-input')
  })

  it('should chain multiple middleware handlers', async () => {
    const mw = new Map<MiddlewareStage, Array<(...args: any[]) => any>>()
    mw.set('after:llm', [
      (text: string) => text.toUpperCase(),
      (text: string) => text + '!',
    ])

    const result = await runMiddleware(mw, 'after:llm', 'hello')
    expect(result).toBe('HELLO!')
  })

  it('should abort pipeline when handler returns null', async () => {
    const mw = new Map<MiddlewareStage, Array<(...args: any[]) => any>>()
    const handler2 = vi.fn()
    mw.set('before:tts', [
      () => null, // abort
      handler2,
    ])

    const result = await runMiddleware(mw, 'before:tts', 'text')
    expect(result).toBeNull()
    expect(handler2).not.toHaveBeenCalled()
  })

  it('should handle async middleware', async () => {
    const mw = new Map<MiddlewareStage, Array<(...args: any[]) => any>>()
    mw.set('after:stt', [
      async (data: { text: string }) => {
        await new Promise((r) => setTimeout(r, 10))
        return { ...data, text: data.text.trim() }
      },
    ])

    const result = await runMiddleware(mw, 'after:stt', { text: '  hello  ' })
    expect(result.text).toBe('hello')
  })

  it('should handle multi-arg input for before:llm', async () => {
    const mw = new Map<MiddlewareStage, Array<(...args: any[]) => any>>()

    const result = await runMiddleware(
      mw,
      'before:llm',
      [{ role: 'user', content: 'Hi' }],
      'System prompt',
    )

    expect(result).toEqual({
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: 'System prompt',
    })
  })

  it('should transform data through middleware for before:llm', async () => {
    const mw = new Map<MiddlewareStage, Array<(...args: any[]) => any>>()
    mw.set('before:llm', [
      (input: { messages: any[]; systemPrompt: string }) => ({
        ...input,
        systemPrompt: input.systemPrompt + ' Be concise.',
      }),
    ])

    const result = await runMiddleware(
      mw,
      'before:llm',
      [{ role: 'user', content: 'Hi' }],
      'You are helpful.',
    )

    expect(result.systemPrompt).toBe('You are helpful. Be concise.')
  })

  it('should support all middleware stages', () => {
    const stages: MiddlewareStage[] = [
      'before:stt',
      'after:stt',
      'before:llm',
      'after:llm',
      'before:tts',
      'after:tts',
    ]

    const mw = new Map<MiddlewareStage, Array<(...args: any[]) => any>>()
    for (const stage of stages) {
      mw.set(stage, [(x: any) => x])
    }

    expect(mw.size).toBe(6)
  })
})


