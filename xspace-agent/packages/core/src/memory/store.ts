// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

// =============================================================================
// Memory Store — JSON-based persistent storage for agent memories
// =============================================================================

import * as fs from 'fs'
import * as path from 'path'
import { getLogger } from '../logger'
import type { Memory, MemoryType, UserProfile } from './types'
import { EmbeddingClient, searchBySimilarity } from './embeddings'

interface MemoryStoreData {
  memories: Memory[]
  users: Record<string, UserProfile>
}

/**
 * Persistent memory store backed by local JSON files.
 *
 * Stores episodic and semantic memories with optional embedding vectors
 * for similarity-based retrieval. Also manages user profiles that accumulate
 * facts across conversations.
 *
 * @example
 * ```typescript
 * const store = new MemoryStore('./memory', embeddingClient)
 * await store.load()
 *
 * await store.addMemory({
 *   type: 'episodic',
 *   content: 'User @alice is building a DEX on Solana',
 *   speaker: '@alice',
 * })
 *
 * const results = await store.search('Solana development', { limit: 3 })
 * ```
 */
export class MemoryStore {
  private storagePath: string
  private maxMemories: number
  private data: MemoryStoreData = { memories: [], users: {} }
  private embeddings: EmbeddingClient | null
  private dirty = false

  constructor(
    storagePath: string,
    embeddings: EmbeddingClient | null = null,
    maxMemories = 1000,
  ) {
    this.storagePath = storagePath
    this.embeddings = embeddings
    this.maxMemories = maxMemories
  }

  /** Load memories from disk. Creates the storage directory if needed. */
  async load(): Promise<void> {
    const logger = getLogger()
    try {
      fs.mkdirSync(this.storagePath, { recursive: true })

      const memoriesPath = path.join(this.storagePath, 'memories.json')
      if (fs.existsSync(memoriesPath)) {
        const raw = fs.readFileSync(memoriesPath, 'utf-8')
        const parsed = JSON.parse(raw)
        this.data.memories = parsed.memories ?? []
        this.data.users = parsed.users ?? {}
      }
      logger.info(`Memory store loaded: ${this.data.memories.length} memories, ${Object.keys(this.data.users).length} user profiles`)
    } catch (err) {
      logger.warn('Failed to load memory store, starting fresh', { error: err })
      this.data = { memories: [], users: {} }
    }
  }

  /** Persist all memories to disk. */
  async save(): Promise<void> {
    if (!this.dirty) return
    const logger = getLogger()
    try {
      fs.mkdirSync(this.storagePath, { recursive: true })
      const memoriesPath = path.join(this.storagePath, 'memories.json')
      fs.writeFileSync(memoriesPath, JSON.stringify(this.data, null, 2), 'utf-8')
      this.dirty = false
    } catch (err) {
      logger.error('Failed to save memory store', { error: err })
    }
  }

  /**
   * Add a new memory. Generates an embedding if an embedding client is available.
   * Evicts oldest memories when the store exceeds maxMemories.
   */
  async addMemory(opts: {
    type: MemoryType
    content: string
    speaker?: string
    spaceUrl?: string
  }): Promise<Memory> {
    const memory: Memory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: opts.type,
      content: opts.content,
      speaker: opts.speaker,
      spaceUrl: opts.spaceUrl,
      createdAt: new Date().toISOString(),
    }

    // Generate embedding
    if (this.embeddings) {
      try {
        memory.embedding = await this.embeddings.embed(opts.content)
      } catch {
        // Proceed without embedding — retrieval falls back to keyword matching
      }
    }

    this.data.memories.push(memory)
    this.dirty = true

    // Evict oldest if over limit
    if (this.data.memories.length > this.maxMemories) {
      this.data.memories = this.data.memories.slice(-this.maxMemories)
    }

    return memory
  }

  /**
   * Search memories by semantic similarity to a query string.
   * Falls back to keyword matching when embeddings are unavailable.
   */
  async search(
    query: string,
    opts: { limit?: number; speaker?: string; type?: MemoryType } = {},
  ): Promise<Array<Memory & { score: number }>> {
    const { limit = 5, speaker, type } = opts

    let candidates = this.data.memories
    if (speaker) {
      candidates = candidates.filter((m) => m.speaker === speaker)
    }
    if (type) {
      candidates = candidates.filter((m) => m.type === type)
    }

    // Semantic search with embeddings
    if (this.embeddings) {
      try {
        const queryEmbedding = await this.embeddings.embed(query)
        return searchBySimilarity(queryEmbedding, candidates, { limit, minScore: 0.25 })
      } catch {
        // Fall through to keyword search
      }
    }

    // Fallback: keyword matching
    return this.keywordSearch(query, candidates, limit)
  }

  /** Get all memories (optionally filtered). */
  getMemories(opts: { speaker?: string; type?: MemoryType } = {}): Memory[] {
    let results = this.data.memories
    if (opts.speaker) results = results.filter((m) => m.speaker === opts.speaker)
    if (opts.type) results = results.filter((m) => m.type === opts.type)
    return results
  }

  /** Delete a memory by ID. */
  deleteMemory(id: string): boolean {
    const idx = this.data.memories.findIndex((m) => m.id === id)
    if (idx === -1) return false
    this.data.memories.splice(idx, 1)
    this.dirty = true
    return true
  }

  /** Clear all memories. */
  clearMemories(): void {
    this.data.memories = []
    this.dirty = true
  }

  // ── User Profiles ──────────────────────────────────────────

  /** Get a user profile by username. */
  getUserProfile(username: string): UserProfile | null {
    return this.data.users[username] ?? null
  }

  /** Get all known user profiles. */
  getAllUserProfiles(): UserProfile[] {
    return Object.values(this.data.users)
  }

  /** Update a user profile, creating it if it doesn't exist. */
  updateUserProfile(
    username: string,
    update: { newFacts?: string[]; lastSeen?: string },
  ): UserProfile {
    const now = new Date().toISOString()
    let profile = this.data.users[username]

    if (!profile) {
      profile = {
        username,
        facts: [],
        firstSeen: update.lastSeen ?? now,
        lastSeen: update.lastSeen ?? now,
        interactions: 0,
      }
      this.data.users[username] = profile
    }

    if (update.newFacts) {
      // Deduplicate facts by content similarity (simple exact match)
      for (const fact of update.newFacts) {
        const normalized = fact.toLowerCase().trim()
        const isDuplicate = profile.facts.some(
          (f) => f.toLowerCase().trim() === normalized,
        )
        if (!isDuplicate) {
          profile.facts.push(fact)
        }
      }
      // Keep facts manageable
      if (profile.facts.length > 50) {
        profile.facts = profile.facts.slice(-50)
      }
    }

    if (update.lastSeen) {
      profile.lastSeen = update.lastSeen
    }
    profile.interactions++
    this.dirty = true

    return profile
  }

  /** Delete a user profile. */
  deleteUserProfile(username: string): boolean {
    if (!this.data.users[username]) return false
    delete this.data.users[username]
    this.dirty = true
    return true
  }

  // ── Stats ──────────────────────────────────────────────────

  /** Get memory store statistics. */
  getStats(): {
    totalMemories: number
    episodicCount: number
    semanticCount: number
    userProfileCount: number
    withEmbeddings: number
  } {
    const memories = this.data.memories
    return {
      totalMemories: memories.length,
      episodicCount: memories.filter((m) => m.type === 'episodic').length,
      semanticCount: memories.filter((m) => m.type === 'semantic').length,
      userProfileCount: Object.keys(this.data.users).length,
      withEmbeddings: memories.filter((m) => m.embedding && m.embedding.length > 0).length,
    }
  }

  // ── Private ────────────────────────────────────────────────

  private keywordSearch(
    query: string,
    candidates: Memory[],
    limit: number,
  ): Array<Memory & { score: number }> {
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2)

    if (queryWords.length === 0) return []

    return candidates
      .map((memory) => {
        const content = memory.content.toLowerCase()
        const matchedWords = queryWords.filter((w) => content.includes(w))
        const score = matchedWords.length / queryWords.length
        return { ...memory, score }
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }
}


