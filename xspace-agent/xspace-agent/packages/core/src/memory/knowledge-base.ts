// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§68]

// =============================================================================
// Knowledge Base — Document ingestion, chunking, and retrieval (RAG)
// =============================================================================

import * as fs from 'fs'
import * as path from 'path'
import { getLogger } from '../logger'
import type { DocumentChunk, IndexedDocument, KnowledgeConfig } from './types'
import { EmbeddingClient, searchBySimilarity } from './embeddings'

const DEFAULT_CHUNK_SIZE = 500
const DEFAULT_CHUNK_OVERLAP = 50

/**
 * RAG knowledge base that indexes user-provided documents for retrieval
 * during conversations.
 *
 * Supports markdown (.md), plain text (.txt), and JSON (.json) files.
 * Documents are chunked, embedded, and searched by semantic similarity.
 *
 * @example
 * ```typescript
 * const kb = new KnowledgeBase({
 *   directory: './knowledge',
 *   embeddingApiKey: process.env.OPENAI_API_KEY!,
 * })
 * await kb.ingest()
 *
 * const results = await kb.search('tokenomics')
 * // → [{ content: "Total supply is 1B tokens...", score: 0.87, source: "tokenomics.md" }]
 * ```
 */
export class KnowledgeBase {
  private config: Required<
    Pick<KnowledgeConfig, 'directory' | 'chunkSize' | 'chunkOverlap' | 'maxRetrievedChunks'>
  > & { embeddingApiKey?: string; embeddingModel?: string }
  private chunks: DocumentChunk[] = []
  private documents: IndexedDocument[] = []
  private embeddings: EmbeddingClient | null = null
  private indexPath: string

  constructor(config: KnowledgeConfig) {
    this.config = {
      directory: config.directory,
      chunkSize: config.chunkSize ?? DEFAULT_CHUNK_SIZE,
      chunkOverlap: config.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
      maxRetrievedChunks: config.maxRetrievedChunks ?? 3,
      embeddingApiKey: config.embeddingApiKey,
      embeddingModel: config.embeddingModel,
    }

    if (config.embeddingApiKey) {
      this.embeddings = new EmbeddingClient(config.embeddingApiKey, config.embeddingModel)
    }

    this.indexPath = path.join(config.directory, '.kb-index.json')
  }

  /**
   * Ingest all supported documents from the knowledge directory.
   * Chunks, embeds, and indexes them for retrieval.
   * Skips documents that haven't changed since the last indexing.
   */
  async ingest(): Promise<{ documentsIndexed: number; totalChunks: number }> {
    const logger = getLogger()
    const dir = this.config.directory

    if (!fs.existsSync(dir)) {
      logger.warn(`Knowledge directory does not exist: ${dir}`)
      return { documentsIndexed: 0, totalChunks: 0 }
    }

    // Load existing index
    this.loadIndex()

    const files = fs
      .readdirSync(dir)
      .filter((f) => /\.(md|txt|json)$/.test(f) && !f.startsWith('.'))
      .map((f) => path.join(dir, f))

    let documentsIndexed = 0

    for (const filePath of files) {
      const stat = fs.statSync(filePath)
      const source = path.basename(filePath)

      // Skip if already indexed and file hasn't changed
      const existing = this.documents.find((d) => d.source === source)
      if (existing && new Date(existing.indexedAt) >= stat.mtime) {
        continue
      }

      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const textContent = this.extractText(filePath, content)
        const newChunks = this.chunkText(textContent, source)

        // Generate embeddings in batches
        if (this.embeddings && newChunks.length > 0) {
          const batchSize = 20
          for (let i = 0; i < newChunks.length; i += batchSize) {
            const batch = newChunks.slice(i, i + batchSize)
            const texts = batch.map((c) => c.content)
            const embeddingVectors = await this.embeddings.embedBatch(texts)
            for (let j = 0; j < batch.length; j++) {
              batch[j].embedding = embeddingVectors[j]
            }
          }
        }

        // Remove old chunks for this source and add new ones
        this.chunks = this.chunks.filter((c) => c.source !== source)
        this.chunks.push(...newChunks)

        // Update document registry
        this.documents = this.documents.filter((d) => d.source !== source)
        this.documents.push({
          source,
          chunkCount: newChunks.length,
          indexedAt: new Date().toISOString(),
        })

        documentsIndexed++
        logger.info(`Indexed ${source}: ${newChunks.length} chunks`)
      } catch (err) {
        logger.warn(`Failed to index ${source}`, { error: err })
      }
    }

    // Remove chunks for documents that no longer exist
    const existingFiles = new Set(files.map((f) => path.basename(f)))
    this.chunks = this.chunks.filter((c) => existingFiles.has(c.source))
    this.documents = this.documents.filter((d) => existingFiles.has(d.source))

    // Persist the index
    this.saveIndex()

    logger.info(
      `Knowledge base: ${documentsIndexed} documents indexed, ${this.chunks.length} total chunks`,
    )
    return { documentsIndexed, totalChunks: this.chunks.length }
  }

  /**
   * Search the knowledge base by semantic similarity.
   * Falls back to keyword search when embeddings are unavailable.
   */
  async search(
    query: string,
    opts: { limit?: number; source?: string } = {},
  ): Promise<Array<DocumentChunk & { score: number }>> {
    const { limit = this.config.maxRetrievedChunks, source } = opts

    let candidates = this.chunks
    if (source) {
      candidates = candidates.filter((c) => c.source === source)
    }

    if (candidates.length === 0) return []

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

  /** Get metadata about all indexed documents. */
  getDocuments(): IndexedDocument[] {
    return [...this.documents]
  }

  /** Get the total number of chunks in the index. */
  getChunkCount(): number {
    return this.chunks.length
  }

  /** Remove a document and its chunks from the index. */
  removeDocument(source: string): boolean {
    const before = this.chunks.length
    this.chunks = this.chunks.filter((c) => c.source !== source)
    this.documents = this.documents.filter((d) => d.source !== source)
    if (this.chunks.length !== before) {
      this.saveIndex()
      return true
    }
    return false
  }

  /** Reindex a specific document. */
  async reindexDocument(source: string): Promise<number> {
    const filePath = path.join(this.config.directory, source)
    if (!fs.existsSync(filePath)) return 0

    // Remove existing entry to force re-ingestion
    this.documents = this.documents.filter((d) => d.source !== source)
    this.chunks = this.chunks.filter((c) => c.source !== source)

    const result = await this.ingest()
    return result.totalChunks
  }

  /** Clear the entire index. */
  clear(): void {
    this.chunks = []
    this.documents = []
    this.saveIndex()
  }

  // ── Private ────────────────────────────────────────────────

  private extractText(filePath: string, raw: string): string {
    const ext = path.extname(filePath).toLowerCase()
    switch (ext) {
      case '.json':
        try {
          const obj = JSON.parse(raw)
          return JSON.stringify(obj, null, 2)
        } catch {
          return raw
        }
      case '.md':
      case '.txt':
      default:
        return raw
    }
  }

  /**
   * Split text into overlapping chunks of approximately `chunkSize` tokens.
   * Uses paragraph boundaries when possible for cleaner splits.
   */
  private chunkText(text: string, source: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = []

    // Split by paragraphs first, then re-combine into chunks
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim())

    let currentChunk = ''
    let chunkIndex = 0

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph)

      // If a single paragraph exceeds chunk size, split it by sentences
      if (paragraphTokens > this.config.chunkSize) {
        // Flush current chunk first
        if (currentChunk.trim()) {
          chunks.push(this.createChunk(currentChunk.trim(), source, chunkIndex++))
          // Keep overlap from the end of the current chunk
          currentChunk = this.getOverlapText(currentChunk)
        }

        const sentences = paragraph.match(/[^.!?]+[.!?]+\s*/g) || [paragraph]
        for (const sentence of sentences) {
          if (
            this.estimateTokens(currentChunk + sentence) > this.config.chunkSize &&
            currentChunk.trim()
          ) {
            chunks.push(this.createChunk(currentChunk.trim(), source, chunkIndex++))
            currentChunk = this.getOverlapText(currentChunk)
          }
          currentChunk += sentence
        }
        continue
      }

      // Check if adding this paragraph would exceed chunk size
      if (
        this.estimateTokens(currentChunk + '\n\n' + paragraph) > this.config.chunkSize &&
        currentChunk.trim()
      ) {
        chunks.push(this.createChunk(currentChunk.trim(), source, chunkIndex++))
        currentChunk = this.getOverlapText(currentChunk)
      }

      currentChunk += (currentChunk ? '\n\n' : '') + paragraph
    }

    // Don't forget the last chunk
    if (currentChunk.trim()) {
      chunks.push(this.createChunk(currentChunk.trim(), source, chunkIndex))
    }

    return chunks
  }

  private createChunk(content: string, source: string, index: number): DocumentChunk {
    return {
      id: `chunk_${source}_${index}`,
      source,
      content,
      chunkIndex: index,
    }
  }

  private getOverlapText(text: string): string {
    if (this.config.chunkOverlap <= 0) return ''
    const words = text.split(/\s+/)
    const overlapWords = Math.min(this.config.chunkOverlap, words.length)
    return words.slice(-overlapWords).join(' ') + ' '
  }

  /** Rough token estimation: ~4 characters per token. */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  private keywordSearch(
    query: string,
    candidates: DocumentChunk[],
    limit: number,
  ): Array<DocumentChunk & { score: number }> {
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2)

    if (queryWords.length === 0) return []

    return candidates
      .map((chunk) => {
        const content = chunk.content.toLowerCase()
        const matchedWords = queryWords.filter((w) => content.includes(w))
        const score = matchedWords.length / queryWords.length
        return { ...chunk, score }
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  private loadIndex(): void {
    try {
      if (fs.existsSync(this.indexPath)) {
        const raw = fs.readFileSync(this.indexPath, 'utf-8')
        const data = JSON.parse(raw)
        this.chunks = data.chunks ?? []
        this.documents = data.documents ?? []
      }
    } catch {
      this.chunks = []
      this.documents = []
    }
  }

  private saveIndex(): void {
    try {
      fs.mkdirSync(path.dirname(this.indexPath), { recursive: true })
      fs.writeFileSync(
        this.indexPath,
        JSON.stringify({ chunks: this.chunks, documents: this.documents }, null, 2),
        'utf-8',
      )
    } catch (err) {
      getLogger().warn('Failed to save knowledge base index', { error: err })
    }
  }
}


