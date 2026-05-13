// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Retrieval Module — Unified memory + knowledge base context injection
// =============================================================================

import { getLogger } from '../logger'
import type { MemoryStore } from './store'
import type { KnowledgeBase } from './knowledge-base'
import type { RetrievalResult } from './types'

/**
 * Unified retrieval module that searches both the memory store and knowledge
 * base, then formats results as context for injection into the LLM system prompt.
 *
 * @example
 * ```typescript
 * const retriever = new ContextRetriever(memoryStore, knowledgeBase)
 * const context = await retriever.getContext({
 *   query: 'Tell me about the tokenomics',
 *   speaker: '@cryptodude',
 *   maxMemories: 5,
 *   maxChunks: 3,
 * })
 * // context is a formatted string ready to append to the system prompt
 * ```
 */
export class ContextRetriever {
  private memoryStore: MemoryStore | null
  private knowledgeBase: KnowledgeBase | null

  constructor(
    memoryStore: MemoryStore | null = null,
    knowledgeBase: KnowledgeBase | null = null,
  ) {
    this.memoryStore = memoryStore
    this.knowledgeBase = knowledgeBase
  }

  /**
   * Retrieve relevant context from memory and knowledge base,
   * formatted as a string for system prompt injection.
   */
  async getContext(opts: {
    query: string
    speaker?: string
    maxMemories?: number
    maxChunks?: number
  }): Promise<string> {
    const { query, speaker, maxMemories = 5, maxChunks = 3 } = opts
    const logger = getLogger()
    const sections: string[] = []

    // 1. User profile (if we know this speaker)
    if (this.memoryStore && speaker) {
      const profile = this.memoryStore.getUserProfile(speaker)
      if (profile && profile.facts.length > 0) {
        sections.push(
          `## What you know about ${speaker}:\n` +
            profile.facts.map((f) => `- ${f}`).join('\n'),
        )
      }
    }

    // 2. Relevant memories
    if (this.memoryStore) {
      try {
        const memories = await this.memoryStore.search(query, {
          limit: maxMemories,
          speaker,
        })
        if (memories.length > 0) {
          sections.push(
            `## Relevant memories:\n` +
              memories.map((m) => `- ${m.content}`).join('\n'),
          )
        }
      } catch (err) {
        logger.warn('Memory retrieval failed', { error: err })
      }
    }

    // 3. Knowledge base documents
    if (this.knowledgeBase) {
      try {
        const chunks = await this.knowledgeBase.search(query, { limit: maxChunks })
        if (chunks.length > 0) {
          sections.push(
            `## Relevant knowledge:\n` +
              chunks
                .map((c) => `[Source: ${c.source}]\n${c.content}`)
                .join('\n\n'),
          )
        }
      } catch (err) {
        logger.warn('Knowledge base retrieval failed', { error: err })
      }
    }

    return sections.length > 0
      ? '\n\n--- Retrieved Context ---\n' + sections.join('\n\n')
      : ''
  }

  /**
   * Raw retrieval — returns structured results from both sources
   * (useful for admin UI or debugging).
   */
  async retrieve(opts: {
    query: string
    speaker?: string
    limit?: number
  }): Promise<RetrievalResult[]> {
    const { query, speaker, limit = 10 } = opts
    const results: RetrievalResult[] = []

    if (this.memoryStore) {
      try {
        const memories = await this.memoryStore.search(query, {
          limit,
          speaker,
        })
        for (const m of memories) {
          results.push({
            content: m.content,
            score: m.score,
            source: 'memory',
            metadata: {
              id: m.id,
              type: m.type,
              speaker: m.speaker,
              createdAt: m.createdAt,
            },
          })
        }
      } catch {
        // Non-critical
      }
    }

    if (this.knowledgeBase) {
      try {
        const chunks = await this.knowledgeBase.search(query, { limit })
        for (const c of chunks) {
          results.push({
            content: c.content,
            score: c.score,
            source: 'knowledge',
            metadata: {
              id: c.id,
              file: c.source,
              chunkIndex: c.chunkIndex,
            },
          })
        }
      } catch {
        // Non-critical
      }
    }

    // Sort by score descending and limit
    return results.sort((a, b) => b.score - a.score).slice(0, limit)
  }
}


