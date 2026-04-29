// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// Memory System — Types
// =============================================================================

/** Types of memories the agent can store. */
export type MemoryType = 'episodic' | 'semantic'

/** A single memory entry stored by the agent. */
export interface Memory {
  /** Unique memory identifier. */
  id: string
  /** Classification of the memory. */
  type: MemoryType
  /** The factual content of the memory. */
  content: string
  /** Speaker username this memory relates to (if any). */
  speaker?: string
  /** URL of the Space where this memory was created. */
  spaceUrl?: string
  /** When this memory was created. */
  createdAt: string
  /** Pre-computed embedding vector for similarity search. */
  embedding?: number[]
}

/** A profile built up from interactions with a repeat speaker. */
export interface UserProfile {
  /** Speaker's X/Twitter username. */
  username: string
  /** Accumulated facts about this speaker. */
  facts: string[]
  /** When we first saw this speaker. */
  firstSeen: string
  /** When we last saw this speaker. */
  lastSeen: string
  /** Total number of conversational exchanges with this speaker. */
  interactions: number
}

/** Configuration for the agent memory system. */
export interface MemoryConfig {
  /** Enable the memory system (default: false). */
  enabled?: boolean
  /** Directory to store memory JSON files (default: './memory'). */
  storagePath?: string
  /** Maximum number of memories to retain (default: 1000). */
  maxMemories?: number
  /** Maximum memories returned per retrieval query (default: 5). */
  maxRetrievedMemories?: number
  /** Model to use for memory extraction (default: uses the agent's LLM). */
  extractionModel?: string
  /** API key for embedding generation (uses OpenAI text-embedding-3-small). */
  embeddingApiKey?: string
}

/** Configuration for the RAG knowledge base. */
export interface KnowledgeConfig {
  /** Directory containing documents to index. */
  directory: string
  /** Target tokens per chunk (default: 500). */
  chunkSize?: number
  /** Overlap tokens between chunks (default: 50). */
  chunkOverlap?: number
  /** Maximum chunks to retrieve per query (default: 3). */
  maxRetrievedChunks?: number
  /** OpenAI API key for embedding generation. */
  embeddingApiKey?: string
  /** Embedding model to use (default: 'text-embedding-3-small'). */
  embeddingModel?: string
}

/** A chunk of a document in the knowledge base. */
export interface DocumentChunk {
  /** Unique chunk identifier. */
  id: string
  /** Source file path. */
  source: string
  /** The chunk text content. */
  content: string
  /** Index of this chunk within the source document. */
  chunkIndex: number
  /** Pre-computed embedding vector. */
  embedding?: number[]
}

/** Metadata about an indexed document. */
export interface IndexedDocument {
  /** Source file path. */
  source: string
  /** Number of chunks generated from this document. */
  chunkCount: number
  /** When this document was last indexed. */
  indexedAt: string
}

/** Result of a memory or knowledge retrieval query. */
export interface RetrievalResult {
  /** The content that was retrieved. */
  content: string
  /** Cosine similarity score (0–1). */
  score: number
  /** Source of this result. */
  source: 'memory' | 'knowledge'
  /** Additional metadata. */
  metadata?: Record<string, unknown>
}


