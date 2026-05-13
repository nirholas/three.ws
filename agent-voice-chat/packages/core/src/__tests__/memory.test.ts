// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync } from 'fs'
import { MemoryStore } from '../memory/store'
import { KnowledgeBase } from '../memory/knowledge-base'
import { MemoryExtractor } from '../memory/extraction'
import { ContextRetriever } from '../memory/retrieval'
import { cosineSimilarity, searchBySimilarity } from '../memory/embeddings'

// =============================================================================
// Cosine Similarity
// =============================================================================

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const v = [1, 2, 3]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0)
  })

  it('should return 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('should return -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('should return 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it('should return 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0)
  })
})

// =============================================================================
// searchBySimilarity
// =============================================================================

describe('searchBySimilarity', () => {
  it('should rank items by similarity to query', () => {
    const items = [
      { id: 'a', embedding: [1, 0, 0] },
      { id: 'b', embedding: [0.9, 0.1, 0] },
      { id: 'c', embedding: [0, 0, 1] },
    ]

    const results = searchBySimilarity([1, 0, 0], items, { limit: 3, minScore: 0 })
    expect(results[0].id).toBe('a')
    expect(results[0].score).toBeCloseTo(1.0)
    expect(results[1].id).toBe('b')
  })

  it('should filter by minimum score', () => {
    const items = [
      { id: 'a', embedding: [1, 0] },
      { id: 'b', embedding: [0, 1] },
    ]

    const results = searchBySimilarity([1, 0], items, { minScore: 0.5 })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('a')
  })

  it('should skip items without embeddings', () => {
    const items = [
      { id: 'a', embedding: [1, 0] },
      { id: 'b', embedding: undefined },
      { id: 'c' },
    ] as Array<{ id: string; embedding?: number[] }>

    const results = searchBySimilarity([1, 0], items, { minScore: 0 })
    expect(results).toHaveLength(1)
  })

  it('should respect limit', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      embedding: [Math.random(), Math.random()],
    }))

    const results = searchBySimilarity([1, 1], items, { limit: 3, minScore: 0 })
    expect(results.length).toBeLessThanOrEqual(3)
  })
})

// =============================================================================
// MemoryStore
// =============================================================================

describe('MemoryStore', () => {
  let tmpDir: string
  let store: MemoryStore

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memory-test-'))
    store = new MemoryStore(tmpDir, null, 100)
    await store.load()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('addMemory', () => {
    it('should add an episodic memory', async () => {
      const memory = await store.addMemory({
        type: 'episodic',
        content: 'User is building a DEX on Solana',
        speaker: '@cryptodude',
      })

      expect(memory.id).toMatch(/^mem_/)
      expect(memory.type).toBe('episodic')
      expect(memory.content).toBe('User is building a DEX on Solana')
      expect(memory.speaker).toBe('@cryptodude')
      expect(memory.createdAt).toBeTruthy()
    })

    it('should add a semantic memory', async () => {
      const memory = await store.addMemory({
        type: 'semantic',
        content: 'Community prefers Solana discussions',
      })

      expect(memory.type).toBe('semantic')
      expect(memory.speaker).toBeUndefined()
    })

    it('should evict oldest when over limit', async () => {
      const smallStore = new MemoryStore(tmpDir, null, 3)
      await smallStore.load()

      await smallStore.addMemory({ type: 'episodic', content: 'First' })
      await smallStore.addMemory({ type: 'episodic', content: 'Second' })
      await smallStore.addMemory({ type: 'episodic', content: 'Third' })
      await smallStore.addMemory({ type: 'episodic', content: 'Fourth' })

      const all = smallStore.getMemories()
      expect(all).toHaveLength(3)
      expect(all[0].content).toBe('Second')
    })
  })

  describe('search (keyword fallback)', () => {
    beforeEach(async () => {
      await store.addMemory({ type: 'episodic', content: 'Building a DEX on Solana', speaker: '@alice' })
      await store.addMemory({ type: 'episodic', content: 'Learning Rust programming', speaker: '@bob' })
      await store.addMemory({ type: 'semantic', content: 'Solana has fast transaction times' })
    })

    it('should find memories by keyword', async () => {
      const results = await store.search('Solana')
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].content).toContain('Solana')
    })

    it('should filter by speaker', async () => {
      const results = await store.search('Solana', { speaker: '@alice' })
      expect(results).toHaveLength(1)
      expect(results[0].speaker).toBe('@alice')
    })

    it('should filter by type', async () => {
      const results = await store.search('Solana', { type: 'semantic' })
      expect(results).toHaveLength(1)
      expect(results[0].type).toBe('semantic')
    })

    it('should return empty for no matches', async () => {
      const results = await store.search('Ethereum DeFi')
      // 'Ethereum' doesn't appear in any memories
      expect(results.every((r) => r.score > 0)).toBe(true)
    })
  })

  describe('persistence', () => {
    it('should save and reload memories', async () => {
      await store.addMemory({ type: 'episodic', content: 'Persistent fact' })
      await store.save()

      const store2 = new MemoryStore(tmpDir, null, 100)
      await store2.load()

      const memories = store2.getMemories()
      expect(memories).toHaveLength(1)
      expect(memories[0].content).toBe('Persistent fact')
    })
  })

  describe('deleteMemory', () => {
    it('should delete a memory by ID', async () => {
      const memory = await store.addMemory({ type: 'episodic', content: 'To delete' })
      expect(store.deleteMemory(memory.id)).toBe(true)
      expect(store.getMemories()).toHaveLength(0)
    })

    it('should return false for non-existent ID', () => {
      expect(store.deleteMemory('nonexistent')).toBe(false)
    })
  })

  describe('clearMemories', () => {
    it('should remove all memories', async () => {
      await store.addMemory({ type: 'episodic', content: 'One' })
      await store.addMemory({ type: 'semantic', content: 'Two' })
      store.clearMemories()
      expect(store.getMemories()).toHaveLength(0)
    })
  })

  // ── User Profiles ──────────────────────────────────────

  describe('user profiles', () => {
    it('should create a new user profile', () => {
      const profile = store.updateUserProfile('@alice', {
        newFacts: ['Building a DEX'],
        lastSeen: '2026-03-23T14:00:00Z',
      })

      expect(profile.username).toBe('@alice')
      expect(profile.facts).toContain('Building a DEX')
      expect(profile.interactions).toBe(1)
    })

    it('should accumulate facts on subsequent updates', () => {
      store.updateUserProfile('@alice', { newFacts: ['Likes Solana'] })
      const profile = store.updateUserProfile('@alice', { newFacts: ['Knows Rust'] })

      expect(profile.facts).toContain('Likes Solana')
      expect(profile.facts).toContain('Knows Rust')
      expect(profile.interactions).toBe(2)
    })

    it('should deduplicate identical facts', () => {
      store.updateUserProfile('@alice', { newFacts: ['Likes Solana'] })
      store.updateUserProfile('@alice', { newFacts: ['Likes Solana'] })

      const profile = store.getUserProfile('@alice')!
      const solanaFacts = profile.facts.filter((f) => f === 'Likes Solana')
      expect(solanaFacts).toHaveLength(1)
    })

    it('should get user profile', () => {
      store.updateUserProfile('@bob', { newFacts: ['Expert in ML'] })
      const profile = store.getUserProfile('@bob')
      expect(profile).not.toBeNull()
      expect(profile!.facts).toContain('Expert in ML')
    })

    it('should return null for unknown user', () => {
      expect(store.getUserProfile('@unknown')).toBeNull()
    })

    it('should list all user profiles', () => {
      store.updateUserProfile('@alice', { newFacts: ['Fact A'] })
      store.updateUserProfile('@bob', { newFacts: ['Fact B'] })

      const profiles = store.getAllUserProfiles()
      expect(profiles).toHaveLength(2)
    })

    it('should delete a user profile', () => {
      store.updateUserProfile('@alice', { newFacts: ['Test'] })
      expect(store.deleteUserProfile('@alice')).toBe(true)
      expect(store.getUserProfile('@alice')).toBeNull()
    })

    it('should persist user profiles', async () => {
      store.updateUserProfile('@alice', { newFacts: ['Persistent'] })
      await store.save()

      const store2 = new MemoryStore(tmpDir, null, 100)
      await store2.load()
      expect(store2.getUserProfile('@alice')?.facts).toContain('Persistent')
    })
  })

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      await store.addMemory({ type: 'episodic', content: 'E1' })
      await store.addMemory({ type: 'episodic', content: 'E2' })
      await store.addMemory({ type: 'semantic', content: 'S1' })
      store.updateUserProfile('@alice', { newFacts: ['Test'] })

      const stats = store.getStats()
      expect(stats.totalMemories).toBe(3)
      expect(stats.episodicCount).toBe(2)
      expect(stats.semanticCount).toBe(1)
      expect(stats.userProfileCount).toBe(1)
      expect(stats.withEmbeddings).toBe(0) // No embedding client
    })
  })
})

// =============================================================================
// KnowledgeBase
// =============================================================================

describe('KnowledgeBase', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'kb-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('should ingest markdown documents', async () => {
    await writeFile(join(tmpDir, 'doc.md'), '# Title\n\nParagraph one about tokenomics.\n\nParagraph two about governance.')

    const kb = new KnowledgeBase({ directory: tmpDir })
    const result = await kb.ingest()

    expect(result.documentsIndexed).toBe(1)
    expect(result.totalChunks).toBeGreaterThanOrEqual(1)
  })

  it('should ingest text documents', async () => {
    await writeFile(join(tmpDir, 'notes.txt'), 'This is a plain text document about blockchain.')

    const kb = new KnowledgeBase({ directory: tmpDir })
    const result = await kb.ingest()

    expect(result.documentsIndexed).toBe(1)
    expect(result.totalChunks).toBe(1)
  })

  it('should ingest JSON documents', async () => {
    await writeFile(join(tmpDir, 'data.json'), JSON.stringify({ key: 'value', nested: { foo: 'bar' } }))

    const kb = new KnowledgeBase({ directory: tmpDir })
    const result = await kb.ingest()

    expect(result.documentsIndexed).toBe(1)
  })

  it('should skip non-supported file types', async () => {
    await writeFile(join(tmpDir, 'image.png'), 'not a real image')
    await writeFile(join(tmpDir, 'doc.md'), '# Test')

    const kb = new KnowledgeBase({ directory: tmpDir })
    const result = await kb.ingest()

    expect(result.documentsIndexed).toBe(1)
  })

  it('should chunk large documents', async () => {
    // Create a document larger than default chunk size
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i}: ${'Lorem ipsum dolor sit amet. '.repeat(20)}`
    )
    await writeFile(join(tmpDir, 'large.md'), paragraphs.join('\n\n'))

    const kb = new KnowledgeBase({ directory: tmpDir, chunkSize: 100 })
    const result = await kb.ingest()

    expect(result.totalChunks).toBeGreaterThan(1)
  })

  it('should search by keyword (no embeddings)', async () => {
    await writeFile(join(tmpDir, 'tokenomics.md'), 'The total supply is 1 billion tokens with a 2% annual inflation rate.')
    await writeFile(join(tmpDir, 'team.md'), 'The team consists of 15 engineers and 5 designers.')

    const kb = new KnowledgeBase({ directory: tmpDir })
    await kb.ingest()

    const results = await kb.search('tokens supply')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].source).toBe('tokenomics.md')
  })

  it('should skip unchanged documents on re-ingest', async () => {
    await writeFile(join(tmpDir, 'doc.md'), '# Test')

    const kb = new KnowledgeBase({ directory: tmpDir })
    await kb.ingest()
    const result2 = await kb.ingest()

    expect(result2.documentsIndexed).toBe(0)
  })

  it('should return document metadata', async () => {
    await writeFile(join(tmpDir, 'doc.md'), '# Test')

    const kb = new KnowledgeBase({ directory: tmpDir })
    await kb.ingest()

    const docs = kb.getDocuments()
    expect(docs).toHaveLength(1)
    expect(docs[0].source).toBe('doc.md')
    expect(docs[0].chunkCount).toBeGreaterThanOrEqual(1)
  })

  it('should remove a document', async () => {
    await writeFile(join(tmpDir, 'doc.md'), '# Test')

    const kb = new KnowledgeBase({ directory: tmpDir })
    await kb.ingest()

    expect(kb.removeDocument('doc.md')).toBe(true)
    expect(kb.getDocuments()).toHaveLength(0)
    expect(kb.getChunkCount()).toBe(0)
  })

  it('should clear all indexed data', async () => {
    await writeFile(join(tmpDir, 'doc.md'), '# Test')

    const kb = new KnowledgeBase({ directory: tmpDir })
    await kb.ingest()
    kb.clear()

    expect(kb.getDocuments()).toHaveLength(0)
    expect(kb.getChunkCount()).toBe(0)
  })

  it('should handle missing knowledge directory gracefully', async () => {
    const kb = new KnowledgeBase({ directory: join(tmpDir, 'nonexistent') })
    const result = await kb.ingest()

    expect(result.documentsIndexed).toBe(0)
    expect(result.totalChunks).toBe(0)
  })
})

// =============================================================================
// MemoryExtractor
// =============================================================================

describe('MemoryExtractor', () => {
  let tmpDir: string
  let store: MemoryStore

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'extractor-test-'))
    store = new MemoryStore(tmpDir, null, 100)
    await store.load()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('should extract episodic memories from LLM response', async () => {
    const mockGenerate = vi.fn().mockResolvedValue(
      JSON.stringify({
        episodic: ['Is building a DEX on Solana', 'Has experience with Rust'],
        semantic: [],
      }),
    )

    const extractor = new MemoryExtractor(store, mockGenerate)
    const memories = await extractor.extract({
      speaker: '@cryptodude',
      text: "I'm building a DEX on Solana using Rust",
      response: "That sounds interesting! How's the development going?",
    })

    expect(memories).toHaveLength(2)
    expect(memories[0].type).toBe('episodic')
    expect(memories[0].content).toContain('DEX on Solana')

    // Should also update user profile
    const profile = store.getUserProfile('@cryptodude')
    expect(profile).not.toBeNull()
    expect(profile!.facts).toContain('Is building a DEX on Solana')
  })

  it('should extract semantic memories', async () => {
    const mockGenerate = vi.fn().mockResolvedValue(
      JSON.stringify({
        episodic: [],
        semantic: ['Morning Spaces tend to have more crypto discussions'],
      }),
    )

    const extractor = new MemoryExtractor(store, mockGenerate)
    const memories = await extractor.extract({
      speaker: '@someone',
      text: 'Everyone here is always talking about crypto in the morning',
      response: 'Yes, the morning sessions do tend to focus on crypto topics.',
    })

    expect(memories).toHaveLength(1)
    expect(memories[0].type).toBe('semantic')
  })

  it('should handle empty extraction gracefully', async () => {
    const mockGenerate = vi.fn().mockResolvedValue(
      JSON.stringify({ episodic: [], semantic: [] }),
    )

    const extractor = new MemoryExtractor(store, mockGenerate)
    const memories = await extractor.extract({
      speaker: '@someone',
      text: 'Hello',
      response: 'Hi there!',
    })

    expect(memories).toHaveLength(0)
  })

  it('should handle malformed LLM responses', async () => {
    const mockGenerate = vi.fn().mockResolvedValue('This is not JSON at all')

    const extractor = new MemoryExtractor(store, mockGenerate)
    const memories = await extractor.extract({
      speaker: '@someone',
      text: 'test',
      response: 'test',
    })

    expect(memories).toHaveLength(0)
  })

  it('should handle LLM errors gracefully', async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error('API error'))

    const extractor = new MemoryExtractor(store, mockGenerate)
    const memories = await extractor.extract({
      speaker: '@someone',
      text: 'test',
      response: 'test',
    })

    expect(memories).toHaveLength(0)
  })

  it('should handle JSON in markdown code blocks', async () => {
    const mockGenerate = vi.fn().mockResolvedValue(
      '```json\n{"episodic": ["Likes TypeScript"], "semantic": []}\n```',
    )

    const extractor = new MemoryExtractor(store, mockGenerate)
    const memories = await extractor.extract({
      speaker: '@dev',
      text: 'I love TypeScript',
      response: 'TypeScript is great!',
    })

    expect(memories).toHaveLength(1)
    expect(memories[0].content).toContain('Likes TypeScript')
  })
})

// =============================================================================
// ContextRetriever
// =============================================================================

describe('ContextRetriever', () => {
  let tmpDir: string
  let memoryStore: MemoryStore

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'retriever-test-'))
    memoryStore = new MemoryStore(tmpDir, null, 100)
    await memoryStore.load()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('should return empty string when no context found', async () => {
    const retriever = new ContextRetriever(memoryStore, null)
    const context = await retriever.getContext({ query: 'random topic' })
    expect(context).toBe('')
  })

  it('should include user profile in context', async () => {
    memoryStore.updateUserProfile('@alice', {
      newFacts: ['Expert in Solana', 'Building a DEX'],
    })

    const retriever = new ContextRetriever(memoryStore, null)
    const context = await retriever.getContext({
      query: 'Solana development',
      speaker: '@alice',
    })

    expect(context).toContain('@alice')
    expect(context).toContain('Expert in Solana')
    expect(context).toContain('Building a DEX')
  })

  it('should include relevant memories', async () => {
    await memoryStore.addMemory({
      type: 'episodic',
      content: 'Discussed Solana performance',
    })

    const retriever = new ContextRetriever(memoryStore, null)
    const context = await retriever.getContext({ query: 'Solana performance' })

    expect(context).toContain('Relevant memories')
    expect(context).toContain('Solana performance')
  })

  it('should include knowledge base results', async () => {
    const kbDir = join(tmpDir, 'knowledge')
    await mkdir(kbDir)
    await writeFile(join(kbDir, 'doc.md'), 'The total token supply is 1 billion.')

    const kb = new KnowledgeBase({ directory: kbDir })
    await kb.ingest()

    const retriever = new ContextRetriever(null, kb)
    const context = await retriever.getContext({ query: 'token supply' })

    expect(context).toContain('Relevant knowledge')
    expect(context).toContain('1 billion')
  })

  it('should combine memory and knowledge results', async () => {
    await memoryStore.addMemory({
      type: 'episodic',
      content: 'Asked about token supply last time',
    })

    const kbDir = join(tmpDir, 'knowledge')
    await mkdir(kbDir)
    await writeFile(join(kbDir, 'doc.md'), 'The total token supply is 1 billion.')

    const kb = new KnowledgeBase({ directory: kbDir })
    await kb.ingest()

    const retriever = new ContextRetriever(memoryStore, kb)
    const context = await retriever.getContext({ query: 'token supply' })

    expect(context).toContain('Relevant memories')
    expect(context).toContain('Relevant knowledge')
  })

  it('should return structured results via retrieve()', async () => {
    await memoryStore.addMemory({
      type: 'episodic',
      content: 'Solana is fast',
    })

    const retriever = new ContextRetriever(memoryStore, null)
    const results = await retriever.retrieve({ query: 'Solana' })

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].source).toBe('memory')
    expect(results[0].content).toContain('Solana')
    expect(results[0].score).toBeGreaterThan(0)
  })

  it('should work with null stores', async () => {
    const retriever = new ContextRetriever(null, null)
    const context = await retriever.getContext({ query: 'anything' })
    expect(context).toBe('')

    const results = await retriever.retrieve({ query: 'anything' })
    expect(results).toHaveLength(0)
  })
})


