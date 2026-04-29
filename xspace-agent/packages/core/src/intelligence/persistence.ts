// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§80]

// =============================================================================
// Intelligence – Conversation Persistence
// =============================================================================

import { readFile, writeFile, mkdir, readdir } from 'fs/promises'
import { join } from 'path'
import type { Message } from '../types'

export interface ConversationRecord {
  id: string
  spaceUrl: string
  startedAt: number
  endedAt: number
  messages: Message[]
  speakers: string[]
  topics: string[]
  summary: string
}

export interface SpaceMetadata {
  startedAt: number
  speakers: string[]
  topics: string[]
  summary: string
}

/**
 * Persists conversation data to disk for cross-session memory.
 * Supports dual-write to PostgreSQL when a database is configured.
 */
export class ConversationStore {
  private storePath: string
  private pgEnabled = false
  private conversationRepo: any = null

  constructor(storePath = '.xspace-conversations') {
    this.storePath = storePath
    this.tryEnablePostgres()
  }

  /** Attempt to enable PostgreSQL dual-write if the database is initialized. */
  private tryEnablePostgres(): void {
    try {
      // Dynamic import to avoid hard dependency — db may not be initialized
      const { getDatabase } = require('../db/connection')
      const { ConversationRepository } = require('../db/repositories/conversation')
      getDatabase() // will throw if not initialized
      this.conversationRepo = new ConversationRepository()
      this.pgEnabled = true
    } catch {
      // Database not initialized — file-only mode
    }
  }

  /** Save a conversation record after leaving a Space. */
  async save(spaceUrl: string, messages: Message[], metadata: SpaceMetadata): Promise<void> {
    await mkdir(this.storePath, { recursive: true })

    const id = this.urlToId(spaceUrl)
    const record: ConversationRecord = {
      id,
      spaceUrl,
      startedAt: metadata.startedAt,
      endedAt: Date.now(),
      messages,
      speakers: metadata.speakers,
      topics: metadata.topics,
      summary: metadata.summary,
    }

    // Always write to JSON file (backward compatible)
    await writeFile(
      join(this.storePath, `${id}.json`),
      JSON.stringify(record, null, 2),
    )

    // Dual-write to PostgreSQL if available
    if (this.pgEnabled && this.conversationRepo) {
      try {
        await this.conversationRepo.create({
          messages: messages as any,
          summary: metadata.summary,
        })
      } catch {
        // Log but don't fail — JSON file is the primary store during migration
      }
    }
  }

  /** Load a previously saved conversation by Space URL. */
  async load(spaceUrl: string): Promise<ConversationRecord | null> {
    const id = this.urlToId(spaceUrl)
    try {
      const data = await readFile(join(this.storePath, `${id}.json`), 'utf-8')
      return JSON.parse(data) as ConversationRecord
    } catch {
      return null
    }
  }

  /** Load the most recent N conversations sorted by end time. */
  async getRecent(limit = 5): Promise<ConversationRecord[]> {
    try {
      const files = await readdir(this.storePath)
      const jsonFiles = files.filter(f => f.endsWith('.json'))

      const records: ConversationRecord[] = []
      for (const file of jsonFiles) {
        try {
          const data = await readFile(join(this.storePath, file), 'utf-8')
          records.push(JSON.parse(data) as ConversationRecord)
        } catch {
          // Skip corrupt files
        }
      }

      return records
        .sort((a, b) => b.endedAt - a.endedAt)
        .slice(0, limit)
    } catch {
      return []
    }
  }

  /** Check if PostgreSQL dual-write is enabled. */
  isPostgresEnabled(): boolean {
    return this.pgEnabled
  }

  /** Extract a stable ID from a Space URL. */
  private urlToId(url: string): string {
    const match = url.match(/spaces\/(\w+)/)
    return match?.[1] ?? url.replace(/[^a-zA-Z0-9]/g, '_')
  }
}


