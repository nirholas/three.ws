// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { logger } = require("../src/server/logger")

/**
 * Build augmented context from memory and knowledge retrieval
 * to inject into the system prompt before each LLM call.
 *
 * @param {object} deps
 * @param {import('./memory-store').MemoryStore} deps.memoryStore
 * @param {import('./knowledge-base').KnowledgeBase} deps.knowledgeBase
 */
class ContextInjector {
  /**
   * @param {object} deps
   * @param {import('./memory-store').MemoryStore} deps.memoryStore
   * @param {import('./knowledge-base').KnowledgeBase} deps.knowledgeBase
   * @param {object} [deps.memoryConfig] - Per-agent memory config overrides
   */
  constructor({ memoryStore, knowledgeBase, memoryConfig }) {
    this.memoryStore = memoryStore
    this.knowledgeBase = knowledgeBase
    this.memoryConfig = memoryConfig || {}
  }

  /**
   * Build context string to append to the system prompt.
   * Runs memory search and knowledge search in parallel.
   *
   * @param {object} params
   * @param {string} params.userText - Current user message
   * @param {string} [params.speaker] - Username of the speaker
   * @param {string} [params.roomId] - Room ID
   * @returns {Promise<string>} Context to inject into system prompt
   */
  async getContext(params) {
    const { userText, speaker, roomId } = params
    const parts = []

    try {
      const [memoryResults, knowledgeResults] = await Promise.all([
        this._getMemoryContext(userText, speaker),
        this._getKnowledgeContext(userText)
      ])

      if (memoryResults) parts.push(memoryResults)
      if (knowledgeResults) parts.push(knowledgeResults)
    } catch (err) {
      logger.error({ err: err.message }, "Context injection failed")
    }

    if (parts.length === 0) return ""
    return "\n\n--- CONTEXT (use naturally, don't mention you're reading from memory/docs) ---\n" + parts.join("\n")
  }

  /**
   * Search memory for relevant context about the speaker and topic.
   */
  async _getMemoryContext(userText, speaker) {
    if (!this.memoryStore) return ""

    const sections = []

    // User profile
    if (speaker) {
      const profile = this.memoryStore.getUserProfile(speaker)
      if (profile && profile.facts.length > 0) {
        sections.push(`## What you know about ${speaker}:\n${profile.facts.map(f => `- ${f}`).join("\n")}`)
      }
    }

    // Search relevant memories — use per-agent config if available
    const searchLimit = this.memoryConfig.maxResults ?? 5
    const searchThreshold = this.memoryConfig.searchThreshold ?? 0.35
    const memories = await this.memoryStore.searchMemories(userText, {
      limit: searchLimit,
      speaker,
      threshold: searchThreshold
    })

    if (memories.length > 0) {
      sections.push(`## Relevant past context:\n${memories.map(m => `- ${m.content}`).join("\n")}`)
    }

    return sections.join("\n\n")
  }

  /**
   * Search knowledge base for relevant document chunks.
   */
  async _getKnowledgeContext(userText) {
    if (!this.knowledgeBase) return ""

    const kbThreshold = this.memoryConfig.searchThreshold ?? 0.35
    const results = await this.knowledgeBase.search(userText, { threshold: kbThreshold })
    if (results.length === 0) return ""

    const chunks = results.map(r => `[${r.docName}]: ${r.content}`).join("\n\n")
    return `## Reference documents:\n${chunks}`
  }
}

module.exports = { ContextInjector }


