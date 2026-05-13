// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createResponseCache } from '../../../src/pipeline/cache'
import type { Message } from '../../../src/types'

describe('createResponseCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const systemPrompt = 'You are helpful.'
  const history: Message[] = [{ role: 'user', content: 'Hi' }]

  // ---------------------------------------------------------------------------
  // Basic get/set
  // ---------------------------------------------------------------------------

  it('should store and retrieve a cached response', () => {
    const cache = createResponseCache()
    cache.set(systemPrompt, history, 'What is 2+2?', 'Four')

    const result = cache.get(systemPrompt, history, 'What is 2+2?')
    expect(result).toBe('Four')
  })

  it('should return undefined for cache miss', () => {
    const cache = createResponseCache()
    const result = cache.get(systemPrompt, history, 'Unknown question')
    expect(result).toBeUndefined()
  })

  it('should differentiate by user text', () => {
    const cache = createResponseCache()
    cache.set(systemPrompt, history, 'question1', 'answer1')
    cache.set(systemPrompt, history, 'question2', 'answer2')

    expect(cache.get(systemPrompt, history, 'question1')).toBe('answer1')
    expect(cache.get(systemPrompt, history, 'question2')).toBe('answer2')
  })

  it('should differentiate by system prompt', () => {
    const cache = createResponseCache()
    cache.set('prompt-a', history, 'test', 'response-a')
    cache.set('prompt-b', history, 'test', 'response-b')

    expect(cache.get('prompt-a', history, 'test')).toBe('response-a')
    expect(cache.get('prompt-b', history, 'test')).toBe('response-b')
  })

  it('should differentiate by conversation history', () => {
    const cache = createResponseCache()
    const history1: Message[] = [{ role: 'user', content: 'context-1' }]
    const history2: Message[] = [{ role: 'user', content: 'context-2' }]

    cache.set(systemPrompt, history1, 'test', 'response-1')
    cache.set(systemPrompt, history2, 'test', 'response-2')

    expect(cache.get(systemPrompt, history1, 'test')).toBe('response-1')
    expect(cache.get(systemPrompt, history2, 'test')).toBe('response-2')
  })

  // ---------------------------------------------------------------------------
  // Size tracking
  // ---------------------------------------------------------------------------

  it('should track cache size', () => {
    const cache = createResponseCache()
    expect(cache.size()).toBe(0)

    cache.set(systemPrompt, history, 'q1', 'a1')
    expect(cache.size()).toBe(1)

    cache.set(systemPrompt, history, 'q2', 'a2')
    expect(cache.size()).toBe(2)
  })

  it('should overwrite existing entries without increasing size', () => {
    const cache = createResponseCache()
    cache.set(systemPrompt, history, 'q1', 'old')
    cache.set(systemPrompt, history, 'q1', 'new')

    expect(cache.size()).toBe(1)
    expect(cache.get(systemPrompt, history, 'q1')).toBe('new')
  })

  // ---------------------------------------------------------------------------
  // Clear
  // ---------------------------------------------------------------------------

  it('should clear all entries', () => {
    const cache = createResponseCache()
    cache.set(systemPrompt, history, 'q1', 'a1')
    cache.set(systemPrompt, history, 'q2', 'a2')

    cache.clear()
    expect(cache.size()).toBe(0)
    expect(cache.get(systemPrompt, history, 'q1')).toBeUndefined()
  })

  // ---------------------------------------------------------------------------
  // TTL expiration
  // ---------------------------------------------------------------------------

  it('should expire entries after TTL', () => {
    const cache = createResponseCache({ ttlMs: 1000 })
    cache.set(systemPrompt, history, 'q1', 'a1')

    expect(cache.get(systemPrompt, history, 'q1')).toBe('a1')

    // Advance past TTL
    vi.advanceTimersByTime(1100)

    expect(cache.get(systemPrompt, history, 'q1')).toBeUndefined()
  })

  it('should not expire entries before TTL', () => {
    const cache = createResponseCache({ ttlMs: 5000 })
    cache.set(systemPrompt, history, 'q1', 'a1')

    vi.advanceTimersByTime(4000)
    expect(cache.get(systemPrompt, history, 'q1')).toBe('a1')
  })

  it('should use default TTL of 5 minutes', () => {
    const cache = createResponseCache()
    cache.set(systemPrompt, history, 'q1', 'a1')

    // 4 minutes — should still be cached
    vi.advanceTimersByTime(4 * 60 * 1000)
    expect(cache.get(systemPrompt, history, 'q1')).toBe('a1')

    // 6 minutes total — should be expired
    vi.advanceTimersByTime(2 * 60 * 1000)
    expect(cache.get(systemPrompt, history, 'q1')).toBeUndefined()
  })

  // ---------------------------------------------------------------------------
  // LRU eviction
  // ---------------------------------------------------------------------------

  it('should evict oldest entry when cache is full', () => {
    const cache = createResponseCache({ maxSize: 3 })

    cache.set(systemPrompt, [], 'q1', 'a1')
    cache.set(systemPrompt, [], 'q2', 'a2')
    cache.set(systemPrompt, [], 'q3', 'a3')
    expect(cache.size()).toBe(3)

    // Adding a 4th should evict q1 (oldest)
    cache.set(systemPrompt, [], 'q4', 'a4')
    expect(cache.size()).toBe(3)
    expect(cache.get(systemPrompt, [], 'q1')).toBeUndefined()
    expect(cache.get(systemPrompt, [], 'q2')).toBe('a2')
    expect(cache.get(systemPrompt, [], 'q4')).toBe('a4')
  })

  it('should promote accessed entries to most-recently-used', () => {
    const cache = createResponseCache({ maxSize: 3 })

    cache.set(systemPrompt, [], 'q1', 'a1')
    cache.set(systemPrompt, [], 'q2', 'a2')
    cache.set(systemPrompt, [], 'q3', 'a3')

    // Access q1, promoting it to MRU
    cache.get(systemPrompt, [], 'q1')

    // Now add q4 — should evict q2 (now the LRU, since q1 was promoted)
    cache.set(systemPrompt, [], 'q4', 'a4')
    expect(cache.get(systemPrompt, [], 'q1')).toBe('a1') // Still present (was promoted)
    expect(cache.get(systemPrompt, [], 'q2')).toBeUndefined() // Evicted
    expect(cache.get(systemPrompt, [], 'q3')).toBe('a3')
    expect(cache.get(systemPrompt, [], 'q4')).toBe('a4')
  })

  it('should use default maxSize of 100', () => {
    const cache = createResponseCache()

    for (let i = 0; i < 105; i++) {
      cache.set(systemPrompt, [], `q${i}`, `a${i}`)
    }

    expect(cache.size()).toBe(100)
    // Oldest 5 should be evicted
    expect(cache.get(systemPrompt, [], 'q0')).toBeUndefined()
    expect(cache.get(systemPrompt, [], 'q4')).toBeUndefined()
    // Most recent should be present
    expect(cache.get(systemPrompt, [], 'q104')).toBe('a104')
  })

  // ---------------------------------------------------------------------------
  // TTL + eviction interaction
  // ---------------------------------------------------------------------------

  it('should prune expired entries before eviction', () => {
    const cache = createResponseCache({ maxSize: 3, ttlMs: 1000 })

    cache.set(systemPrompt, [], 'q1', 'a1')
    cache.set(systemPrompt, [], 'q2', 'a2')
    cache.set(systemPrompt, [], 'q3', 'a3')

    // Expire all entries
    vi.advanceTimersByTime(1100)

    // Adding new entry should prune expired ones first, then fit without eviction
    cache.set(systemPrompt, [], 'q4', 'a4')
    expect(cache.size()).toBe(1) // Only q4 remains
    expect(cache.get(systemPrompt, [], 'q4')).toBe('a4')
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it('should handle empty history array', () => {
    const cache = createResponseCache()
    cache.set(systemPrompt, [], 'q', 'a')
    expect(cache.get(systemPrompt, [], 'q')).toBe('a')
  })

  it('should handle empty user text', () => {
    const cache = createResponseCache()
    cache.set(systemPrompt, history, '', 'response')
    expect(cache.get(systemPrompt, history, '')).toBe('response')
  })

  it('should handle empty system prompt', () => {
    const cache = createResponseCache()
    cache.set('', history, 'q', 'a')
    expect(cache.get('', history, 'q')).toBe('a')
  })

  it('should handle very long responses', () => {
    const cache = createResponseCache()
    const longResponse = 'x'.repeat(100000)
    cache.set(systemPrompt, history, 'q', longResponse)
    expect(cache.get(systemPrompt, history, 'q')).toBe(longResponse)
  })
})


