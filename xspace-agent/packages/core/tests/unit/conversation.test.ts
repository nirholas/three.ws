// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

import { describe, it, expect, vi } from 'vitest'
import { ConversationManager } from '../../src/conversation'

describe('ConversationManager', () => {
  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  it('should accept a system prompt and use default maxHistory', () => {
    const cm = new ConversationManager({ systemPrompt: 'You are helpful.' })
    expect(cm.getSystemPrompt()).toBe('You are helpful.')
    expect(cm.getHistory()).toEqual([])
  })

  it('should accept a custom maxHistory', () => {
    const cm = new ConversationManager({ systemPrompt: 'Hi', maxHistory: 5 })
    // Add 7 messages, only last 5 should remain
    for (let i = 0; i < 7; i++) {
      cm.addMessage('user', `msg-${i}`)
    }
    expect(cm.getHistory()).toHaveLength(5)
    expect(cm.getHistory()[0].content).toBe('msg-2')
    expect(cm.getHistory()[4].content).toBe('msg-6')
  })

  // ---------------------------------------------------------------------------
  // Message management
  // ---------------------------------------------------------------------------

  it('should add messages to history', () => {
    const cm = new ConversationManager({ systemPrompt: 'test' })
    cm.addMessage('user', 'Hello')
    cm.addMessage('assistant', 'Hi there')

    const history = cm.getHistory()
    expect(history).toHaveLength(2)
    expect(history[0]).toEqual({ role: 'user', content: 'Hello' })
    expect(history[1]).toEqual({ role: 'assistant', content: 'Hi there' })
  })

  it('should add system messages', () => {
    const cm = new ConversationManager({ systemPrompt: 'test' })
    cm.addMessage('system', 'Context injection')
    expect(cm.getHistory()[0].role).toBe('system')
  })

  it('should enforce maxHistory by trimming oldest messages', () => {
    const cm = new ConversationManager({ systemPrompt: 'test', maxHistory: 3 })
    cm.addMessage('user', 'one')
    cm.addMessage('assistant', 'two')
    cm.addMessage('user', 'three')
    cm.addMessage('assistant', 'four')

    expect(cm.getHistory()).toHaveLength(3)
    expect(cm.getHistory()[0].content).toBe('two')
    expect(cm.getHistory()[2].content).toBe('four')
  })

  it('should default maxHistory to 20', () => {
    const cm = new ConversationManager({ systemPrompt: 'test' })
    for (let i = 0; i < 25; i++) {
      cm.addMessage('user', `msg-${i}`)
    }
    expect(cm.getHistory()).toHaveLength(20)
    expect(cm.getHistory()[0].content).toBe('msg-5')
  })

  // ---------------------------------------------------------------------------
  // getHistory returns a copy
  // ---------------------------------------------------------------------------

  it('should return a copy of history, not the internal array', () => {
    const cm = new ConversationManager({ systemPrompt: 'test' })
    cm.addMessage('user', 'hi')
    const history = cm.getHistory()
    history.push({ role: 'assistant', content: 'injected' })
    // Internal history should be unaffected
    expect(cm.getHistory()).toHaveLength(1)
  })

  // ---------------------------------------------------------------------------
  // Clear history
  // ---------------------------------------------------------------------------

  it('should clear all history', () => {
    const cm = new ConversationManager({ systemPrompt: 'test' })
    cm.addMessage('user', 'msg1')
    cm.addMessage('assistant', 'msg2')
    cm.clearHistory()
    expect(cm.getHistory()).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // System prompt
  // ---------------------------------------------------------------------------

  it('should get and set the system prompt', () => {
    const cm = new ConversationManager({ systemPrompt: 'original' })
    expect(cm.getSystemPrompt()).toBe('original')
    cm.setSystemPrompt('updated')
    expect(cm.getSystemPrompt()).toBe('updated')
  })

  // ---------------------------------------------------------------------------
  // Middleware
  // ---------------------------------------------------------------------------

  it('should register and run middleware for a stage', async () => {
    const cm = new ConversationManager({ systemPrompt: 'test' })
    const handler = vi.fn((data: any) => ({ ...data, modified: true }))
    cm.use('before:llm', handler)

    const result = await cm.runMiddleware('before:llm', { text: 'hello' })
    expect(handler).toHaveBeenCalledWith({ text: 'hello' })
    expect(result).toEqual({ text: 'hello', modified: true })
  })

  it('should chain multiple middleware handlers in order', async () => {
    const cm = new ConversationManager({ systemPrompt: 'test' })
    cm.use('after:stt', (data: any) => ({ ...data, step1: true }))
    cm.use('after:stt', (data: any) => ({ ...data, step2: true }))

    const result = await cm.runMiddleware('after:stt', { text: 'hello' })
    expect(result).toEqual({ text: 'hello', step1: true, step2: true })
  })

  it('should return null if any middleware handler returns null', async () => {
    const cm = new ConversationManager({ systemPrompt: 'test' })
    cm.use('before:tts', () => null)
    cm.use('before:tts', (data: any) => ({ ...data, should_not_run: true }))

    const result = await cm.runMiddleware('before:tts', { text: 'hello' })
    expect(result).toBeNull()
  })

  it('should return null if any middleware handler returns undefined', async () => {
    const cm = new ConversationManager({ systemPrompt: 'test' })
    cm.use('after:llm', () => undefined)

    const result = await cm.runMiddleware('after:llm', { text: 'hello' })
    expect(result).toBeNull()
  })

  it('should pass through data when no middleware is registered', async () => {
    const cm = new ConversationManager({ systemPrompt: 'test' })
    const result = await cm.runMiddleware('before:stt', { audio: 'data' })
    expect(result).toEqual({ audio: 'data' })
  })

  it('should handle two-argument runMiddleware (messages + systemPrompt)', async () => {
    const cm = new ConversationManager({ systemPrompt: 'test' })
    const messages = [{ role: 'user' as const, content: 'hi' }]
    const result = await cm.runMiddleware('before:llm', messages, 'system prompt')
    expect(result).toEqual({ messages, systemPrompt: 'system prompt' })
  })

  it('should support async middleware handlers', async () => {
    const cm = new ConversationManager({ systemPrompt: 'test' })
    cm.use('after:tts', async (data: any) => {
      return { ...data, async: true }
    })

    const result = await cm.runMiddleware('after:tts', { audio: 'buffer' })
    expect(result).toEqual({ audio: 'buffer', async: true })
  })

  it('should allow middleware on multiple independent stages', async () => {
    const cm = new ConversationManager({ systemPrompt: 'test' })
    cm.use('before:stt', (data: any) => ({ ...data, stt: true }))
    cm.use('before:llm', (data: any) => ({ ...data, llm: true }))

    const sttResult = await cm.runMiddleware('before:stt', { input: 'audio' })
    const llmResult = await cm.runMiddleware('before:llm', { input: 'text' })

    expect(sttResult).toEqual({ input: 'audio', stt: true })
    expect(llmResult).toEqual({ input: 'text', llm: true })
  })
})


