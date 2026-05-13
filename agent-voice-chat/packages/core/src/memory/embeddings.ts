// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Embedding Generation & Similarity Search
// =============================================================================

import axios from 'axios'
import { getLogger } from '../logger'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536

/** Compute cosine similarity between two vectors. Returns 0–1 (higher = more similar). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dotProduct / denominator
}

/**
 * Client for generating embeddings via the OpenAI API.
 * Uses text-embedding-3-small by default (1536 dimensions, $0.02/1M tokens).
 */
export class EmbeddingClient {
  private apiKey: string
  private model: string

  constructor(apiKey: string, model: string = EMBEDDING_MODEL) {
    this.apiKey = apiKey
    this.model = model
  }

  /**
   * Generate an embedding vector for a single text input.
   * @returns A float array of length 1536 (for text-embedding-3-small).
   */
  async embed(text: string): Promise<number[]> {
    return (await this.embedBatch([text]))[0]
  }

  /**
   * Generate embedding vectors for multiple texts in a single API call.
   * @returns Array of float arrays, one per input text.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const logger = getLogger()
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          input: texts,
          model: this.model,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        },
      )

      const data = response.data as {
        data: Array<{ embedding: number[]; index: number }>
      }

      // Sort by index to ensure correct order
      const sorted = data.data.sort((a, b) => a.index - b.index)
      return sorted.map((item) => item.embedding)
    } catch (err) {
      logger.error('Embedding API call failed', { error: err })
      throw new Error(
        `Embedding generation failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /** Get the expected embedding dimensions for the current model. */
  getDimensions(): number {
    return this.model === EMBEDDING_MODEL ? EMBEDDING_DIMENSIONS : EMBEDDING_DIMENSIONS
  }
}

/**
 * Search a collection of items with embeddings by similarity to a query embedding.
 * Returns items sorted by descending similarity score.
 */
export function searchBySimilarity<T extends { embedding?: number[] }>(
  queryEmbedding: number[],
  items: T[],
  opts: { limit?: number; minScore?: number } = {},
): Array<T & { score: number }> {
  const { limit = 5, minScore = 0.3 } = opts

  const scored = items
    .filter((item) => item.embedding && item.embedding.length > 0)
    .map((item) => ({
      ...item,
      score: cosineSimilarity(queryEmbedding, item.embedding!),
    }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, limit)
}


