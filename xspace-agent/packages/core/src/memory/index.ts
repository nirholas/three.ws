// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Memory & RAG — Public API
// =============================================================================

export { MemoryStore } from './store'
export { KnowledgeBase } from './knowledge-base'
export { MemoryExtractor } from './extraction'
export { ContextRetriever } from './retrieval'
export { EmbeddingClient, cosineSimilarity, searchBySimilarity } from './embeddings'

export type {
  Memory,
  MemoryType,
  UserProfile,
  MemoryConfig,
  KnowledgeConfig,
  DocumentChunk,
  IndexedDocument,
  RetrievalResult,
} from './types'


