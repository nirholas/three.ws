// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const axios = require("axios")
const { logger } = require("../src/server/logger")

const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || "openai"
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small"
const EMBEDDING_DIMENSIONS = 1536

// ── Provider implementations ──────────────────────────────────────

/**
 * OpenAI embedding provider.
 */
async function openaiEmbed(texts, model) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI embeddings")

  const response = await axios.post(
    "https://api.openai.com/v1/embeddings",
    { model, input: texts },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    }
  )
  const sorted = response.data.data.sort((a, b) => a.index - b.index)
  return sorted.map(d => d.embedding)
}

/**
 * Cohere embedding provider.
 */
async function cohereEmbed(texts, model) {
  const apiKey = process.env.COHERE_API_KEY
  if (!apiKey) throw new Error("COHERE_API_KEY is required for Cohere embeddings")

  const cohereModel = model || "embed-english-v3.0"
  const response = await axios.post(
    "https://api.cohere.ai/v1/embed",
    {
      texts,
      model: cohereModel,
      input_type: "search_document",
      truncate: "END"
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    }
  )
  return response.data.embeddings
}

/**
 * Local embedding provider using simple TF-IDF-like hashing.
 * Produces deterministic, low-quality embeddings for air-gapped / offline use.
 * No external dependencies required.
 */
function localEmbed(texts) {
  const dim = 256
  return texts.map(text => {
    const vec = new Array(dim).fill(0)
    const words = text.toLowerCase().split(/\s+/)
    for (const word of words) {
      let hash = 0
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0
      }
      const idx = Math.abs(hash) % dim
      vec[idx] += (hash > 0 ? 1 : -1) / Math.sqrt(words.length || 1)
    }
    // Normalize
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
    if (mag > 0) {
      for (let i = 0; i < dim; i++) vec[i] /= mag
    }
    return vec
  })
}

// ── Provider registry ─────────────────────────────────────────────

const providers = {
  openai: openaiEmbed,
  cohere: cohereEmbed,
  local: (texts) => localEmbed(texts)
}

/**
 * Get embeddings using the configured provider.
 * @param {string|string[]} input - Text(s) to embed
 * @param {object} [opts] - Override options
 * @param {string} [opts.provider] - Override provider
 * @param {string} [opts.model] - Override model
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
async function getEmbeddings(input, opts = {}) {
  const texts = Array.isArray(input) ? input : [input]
  if (texts.length === 0) return []

  const providerName = opts.provider || EMBEDDING_PROVIDER
  const model = opts.model || EMBEDDING_MODEL
  const embedFn = providers[providerName]

  if (!embedFn) {
    throw new Error(`Unknown embedding provider: ${providerName}. Available: ${Object.keys(providers).join(", ")}`)
  }

  try {
    return await embedFn(texts, model)
  } catch (err) {
    logger.error({ err: err.message, provider: providerName, model }, "Embedding API error")
    throw err
  }
}

/**
 * Get a single embedding vector for a text.
 * @param {string} text
 * @param {object} [opts] - Override options
 * @returns {Promise<number[]>}
 */
async function getEmbedding(text, opts = {}) {
  const results = await getEmbeddings(text, opts)
  return results[0]
}

/**
 * Compute cosine similarity between two vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} Similarity score between -1 and 1
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const magnitude = Math.sqrt(magA) * Math.sqrt(magB)
  return magnitude === 0 ? 0 : dot / magnitude
}

/**
 * Find the top-k most similar items from a list by cosine similarity.
 * @param {number[]} queryEmbedding - The query vector
 * @param {{ embedding: number[], [key: string]: any }[]} items - Items with embeddings
 * @param {number} topK - Number of results to return
 * @param {number} threshold - Minimum similarity score (default 0.3)
 * @returns {{ item: any, score: number }[]}
 */
function findSimilar(queryEmbedding, items, topK = 5, threshold = 0.3) {
  const scored = items
    .filter(item => item.embedding && item.embedding.length > 0)
    .map(item => ({
      item,
      score: cosineSimilarity(queryEmbedding, item.embedding)
    }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  return scored
}

module.exports = {
  getEmbedding,
  getEmbeddings,
  cosineSimilarity,
  findSimilar,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_PROVIDER,
  providers
}


