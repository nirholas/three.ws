// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// =============================================================================
// Pipeline – Response Cache
// =============================================================================

import { createHash } from 'crypto'
import type { Message } from '../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheConfig {
  /** Maximum number of entries to keep in the cache (default: 100) */
  maxSize?: number
  /** Time-to-live for each cache entry in milliseconds (default: 300_000 = 5 min) */
  ttlMs?: number
}

interface CacheEntry {
  response: string
  createdAt: number
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function hashKey(systemPrompt: string, history: Message[], userText: string): string {
  const payload = JSON.stringify({ systemPrompt, history, userText })
  return createHash('sha256').update(payload).digest('hex')
}

/**
 * Creates an LRU response cache for identical prompts.
 * Disabled by default — opt in via AIConfig.cache.enabled.
 */
export function createResponseCache(config: CacheConfig = {}) {
  const maxSize = config.maxSize ?? 100
  const ttlMs = config.ttlMs ?? 300_000

  // Map preserves insertion order; oldest entries are at the front.
  const store = new Map<string, CacheEntry>()

  function isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.createdAt > ttlMs
  }

  function pruneExpired(): void {
    for (const [key, entry] of store.entries()) {
      if (isExpired(entry)) store.delete(key)
    }
  }

  function evictOldest(): void {
    const firstKey = store.keys().next().value
    if (firstKey !== undefined) store.delete(firstKey)
  }

  return {
    /**
     * Returns a cached response if one exists and has not expired.
     * Accessing an entry promotes it to most-recently-used.
     */
    get(systemPrompt: string, history: Message[], userText: string): string | undefined {
      const key = hashKey(systemPrompt, history, userText)
      const entry = store.get(key)
      if (!entry) return undefined
      if (isExpired(entry)) {
        store.delete(key)
        return undefined
      }
      // Promote to MRU by re-inserting at the end
      store.delete(key)
      store.set(key, entry)
      return entry.response
    },

    /** Stores a response. Evicts the oldest entry when the cache is full. */
    set(systemPrompt: string, history: Message[], userText: string, response: string): void {
      pruneExpired()
      const key = hashKey(systemPrompt, history, userText)
      if (store.size >= maxSize && !store.has(key)) {
        evictOldest()
      }
      store.set(key, { response, createdAt: Date.now() })
    },

    /** Removes all entries. */
    clear(): void {
      store.clear()
    },

    /** Current number of entries (including possibly-expired ones). */
    size(): number {
      return store.size
    },
  }
}

export type ResponseCache = ReturnType<typeof createResponseCache>


