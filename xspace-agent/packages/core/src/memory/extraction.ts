// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// =============================================================================
// Memory Extraction — LLM-powered fact extraction from conversations
// =============================================================================

import { getLogger } from '../logger'
import type { Memory, MemoryType } from './types'
import type { MemoryStore } from './store'

const EXTRACTION_PROMPT = `Extract factual information worth remembering from this conversation exchange.
Focus on:
- Personal details about the speaker (name, role, expertise, location)
- Projects or products they mention working on
- Technical preferences, tools, or frameworks they use
- Opinions or preferences they express
- Problems or challenges they describe
- Plans or goals they mention

Return a JSON object with two arrays:
- "episodic": facts tied to this specific conversation (e.g., "mentioned having trouble with Anchor framework")
- "semantic": general knowledge that applies broadly (e.g., "the community prefers Solana discussions in morning Spaces")

Return empty arrays if nothing is memorable. Respond ONLY with the JSON object, no other text.

Example response:
{"episodic": ["Is building a DEX on Solana", "Having trouble with Anchor framework"], "semantic": []}`

/**
 * Extracts memorable facts from conversation exchanges using an LLM.
 *
 * After each exchange (user speaks, agent responds), this module identifies
 * noteworthy facts and stores them as episodic or semantic memories.
 */
export class MemoryExtractor {
  private store: MemoryStore
  private generateFn: (prompt: string) => Promise<string>

  /**
   * @param store - The memory store to save extracted facts to.
   * @param generateFn - A function that calls an LLM with a prompt and returns the response text.
   */
  constructor(
    store: MemoryStore,
    generateFn: (prompt: string) => Promise<string>,
  ) {
    this.store = store
    this.generateFn = generateFn
  }

  /**
   * Extract memories from a conversation exchange.
   * @param exchange - The speaker, what they said, and the agent's response.
   * @returns The newly created memories.
   */
  async extract(exchange: {
    speaker: string
    text: string
    response: string
    spaceUrl?: string
  }): Promise<Memory[]> {
    const logger = getLogger()

    try {
      const userPrompt = `Speaker ${exchange.speaker} said: "${exchange.text}"\nAgent responded: "${exchange.response}"`

      const result = await this.generateFn(
        `${EXTRACTION_PROMPT}\n\n${userPrompt}`,
      )

      const parsed = this.parseExtractionResult(result)
      const newMemories: Memory[] = []

      for (const content of parsed.episodic) {
        const memory = await this.store.addMemory({
          type: 'episodic',
          content: `${exchange.speaker}: ${content}`,
          speaker: exchange.speaker,
          spaceUrl: exchange.spaceUrl,
        })
        newMemories.push(memory)
      }

      for (const content of parsed.semantic) {
        const memory = await this.store.addMemory({
          type: 'semantic',
          content,
          spaceUrl: exchange.spaceUrl,
        })
        newMemories.push(memory)
      }

      // Update user profile with extracted episodic facts
      if (exchange.speaker && parsed.episodic.length > 0) {
        this.store.updateUserProfile(exchange.speaker, {
          newFacts: parsed.episodic,
          lastSeen: new Date().toISOString(),
        })
      }

      if (newMemories.length > 0) {
        logger.info(
          `Extracted ${newMemories.length} memories from exchange with ${exchange.speaker}`,
        )
        // Persist after extraction
        await this.store.save()
      }

      return newMemories
    } catch (err) {
      logger.warn('Memory extraction failed, skipping', { error: err })
      return []
    }
  }

  private parseExtractionResult(text: string): {
    episodic: string[]
    semantic: string[]
  } {
    try {
      // Extract JSON from the response (handle markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return { episodic: [], semantic: [] }

      const parsed = JSON.parse(jsonMatch[0])
      return {
        episodic: Array.isArray(parsed.episodic)
          ? parsed.episodic.filter((s: unknown) => typeof s === 'string' && s.trim())
          : [],
        semantic: Array.isArray(parsed.semantic)
          ? parsed.semantic.filter((s: unknown) => typeof s === 'string' && s.trim())
          : [],
      }
    } catch {
      return { episodic: [], semantic: [] }
    }
  }
}


