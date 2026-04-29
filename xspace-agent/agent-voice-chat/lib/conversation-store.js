// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

"use strict"

const fs = require("fs/promises")
const path = require("path")
const zlib = require("zlib")
const { promisify } = require("util")
const { logger } = require("../src/server/logger")

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

/**
 * Persistent conversation store with in-memory cache and optional disk persistence.
 *
 * When `directory` is null or undefined the store is pure in-memory (no disk I/O),
 * which is the default used in tests.  Pass a directory path to enable full
 * persistence and archival to compressed files.
 */
class ConversationStore {
  /**
   * @param {string|null} directory - Base directory for JSON files, or null for in-memory only.
   */
  constructor(directory) {
    this.directory = directory || null
    this.archiveDir = directory ? path.join(directory, "archive") : null

    /** @type {Map<string, object>} Active conversations (full data). */
    this.cache = new Map()

    /**
     * Archive store.
     *  - Disk mode: contains metadata only (id, title, tags, counts, timestamps).
     *  - In-memory mode: contains full conversation objects.
     * @type {Map<string, object>}
     */
    this.archiveCache = new Map()
  }

  // ── Initialisation ──────────────────────────────────────────────

  /**
   * Load all conversations and archive metadata from disk into the in-memory cache.
   * No-op when no directory is configured.
   */
  async load() {
    if (!this.directory) return

    await fs.mkdir(this.directory, { recursive: true })
    await fs.mkdir(this.archiveDir, { recursive: true })

    // Load active conversations
    let files = []
    try {
      files = await fs.readdir(this.directory)
    } catch (err) {
      logger.error({ err: err.message }, "ConversationStore failed to read directory")
      return
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue
      const id = file.slice(0, -5)
      try {
        const raw = await fs.readFile(path.join(this.directory, file), "utf8")
        const conv = JSON.parse(raw)
        this.cache.set(id, conv)
      } catch (err) {
        logger.error({ err: err.message, file }, "ConversationStore failed to load file")
      }
    }

    // Load archive metadata (decompress header of each .json.gz)
    let archiveFiles = []
    try {
      archiveFiles = await fs.readdir(this.archiveDir)
    } catch {
      // archiveDir may not exist yet — safe to ignore
    }

    for (const file of archiveFiles) {
      if (!file.endsWith(".json.gz")) continue
      const id = file.slice(0, -8)
      try {
        const compressed = await fs.readFile(path.join(this.archiveDir, file))
        const conv = JSON.parse((await gunzip(compressed)).toString("utf8"))
        this.archiveCache.set(id, extractMeta(conv))
      } catch (err) {
        logger.error({ err: err.message, file }, "ConversationStore failed to load archive")
      }
    }
  }

  // ── Active conversations ────────────────────────────────────────

  /**
   * Upsert a conversation into the cache and (if configured) write it to disk.
   * Cache update is synchronous; disk write is async and errors are logged, not thrown.
   */
  async save(id, conversation) {
    this.cache.set(id, conversation)
    if (!this.directory) return

    const filePath = path.join(this.directory, `${id}.json`)
    try {
      await fs.writeFile(filePath, JSON.stringify(conversation, null, 2), "utf8")
    } catch (err) {
      logger.error({ err: err.message, id }, "ConversationStore failed to write file")
    }
  }

  /**
   * Delete a conversation from cache (and disk).
   * Searches both active and archived stores.
   * @returns {boolean} true if something was deleted.
   */
  async delete(id) {
    if (this.cache.has(id)) {
      this.cache.delete(id)
      if (this.directory) {
        try {
          await fs.unlink(path.join(this.directory, `${id}.json`))
        } catch (err) {
          if (err.code !== "ENOENT") {
            logger.error({ err: err.message, id }, "ConversationStore failed to delete file")
          }
        }
      }
      return true
    }

    if (this.archiveCache.has(id)) {
      this.archiveCache.delete(id)
      if (this.archiveDir) {
        try {
          await fs.unlink(path.join(this.archiveDir, `${id}.json.gz`))
        } catch (err) {
          if (err.code !== "ENOENT") {
            logger.error({ err: err.message, id }, "ConversationStore failed to delete archive")
          }
        }
      }
      return true
    }

    return false
  }

  /** Return an active conversation by ID, or null if not found. */
  get(id) {
    return this.cache.get(id) || null
  }

  /** Whether an active conversation exists. */
  has(id) {
    return this.cache.has(id)
  }

  /** Array of all active conversations. */
  list() {
    return Array.from(this.cache.values())
  }

  // ── Archival ────────────────────────────────────────────────────

  /** Whether an archived conversation exists. */
  hasArchived(id) {
    return this.archiveCache.has(id)
  }

  /**
   * Array of metadata objects for all archived conversations.
   * In-memory mode returns metadata extracted from the stored objects.
   */
  listArchived() {
    if (!this.directory) {
      return Array.from(this.archiveCache.values()).map(extractMeta)
    }
    return Array.from(this.archiveCache.values())
  }

  /**
   * Archive an active conversation: compress it, move to archive directory,
   * and remove from the active cache.
   * In-memory mode keeps the full object in archiveCache.
   */
  async archive(id) {
    const conv = this.cache.get(id)
    if (!conv) throw new Error(`Conversation "${id}" not found`)

    const archivedConv = { ...conv, archivedAt: Date.now() }

    if (this.archiveDir) {
      const compressed = await gzip(JSON.stringify(archivedConv))
      await fs.writeFile(path.join(this.archiveDir, `${id}.json.gz`), compressed)
      this.archiveCache.set(id, extractMeta(archivedConv))

      // Remove from active store
      try {
        await fs.unlink(path.join(this.directory, `${id}.json`))
      } catch (err) {
        if (err.code !== "ENOENT") {
          logger.error({ err: err.message, id }, "ConversationStore failed to remove file after archiving")
        }
      }
    } else {
      // Pure in-memory: keep full object so messages survive unarchive
      this.archiveCache.set(id, archivedConv)
    }

    this.cache.delete(id)
  }

  /**
   * Restore an archived conversation back to the active cache.
   */
  async unarchive(id) {
    if (!this.archiveCache.has(id)) {
      throw new Error(`Archived conversation "${id}" not found`)
    }

    let conv
    if (this.archiveDir) {
      conv = await this.getArchived(id)
    } else {
      conv = { ...this.archiveCache.get(id) }
    }

    delete conv.archivedAt

    await this.save(id, conv)
    this.archiveCache.delete(id)

    if (this.archiveDir) {
      try {
        await fs.unlink(path.join(this.archiveDir, `${id}.json.gz`))
      } catch (err) {
        if (err.code !== "ENOENT") {
          console.error(`[ConversationStore] Failed to delete archive ${id}.json.gz:`, err.message)
        }
      }
    }
  }

  /**
   * Load the full data of an archived conversation (decompresses from disk).
   * In-memory mode returns the full object directly.
   */
  async getArchived(id) {
    if (!this.archiveCache.has(id)) {
      throw new Error(`Archived conversation "${id}" not found`)
    }

    if (this.archiveDir) {
      const filePath = path.join(this.archiveDir, `${id}.json.gz`)
      const compressed = await fs.readFile(filePath)
      return JSON.parse((await gunzip(compressed)).toString("utf8"))
    }

    // In-memory mode: archiveCache holds the full object
    return { ...this.archiveCache.get(id) }
  }

  /**
   * Archive all active conversations whose `createdAt` is older than `maxAgeDays`.
   * @param {number} maxAgeDays
   * @returns {string[]} IDs that were archived.
   */
  async autoArchiveOld(maxAgeDays = 30) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    const archived = []
    for (const [id, conv] of this.cache) {
      if (conv.createdAt < cutoff) {
        await this.archive(id)
        archived.push(id)
      }
    }
    return archived
  }
}

/** Extract lightweight metadata from a full conversation object. */
function extractMeta(conv) {
  return {
    id: conv.id,
    title: conv.title,
    agentIds: conv.agentIds || [],
    messageCount: conv.messageCount || 0,
    tags: conv.tags || [],
    startedAt: conv.startedAt,
    endedAt: conv.endedAt,
    createdAt: conv.createdAt,
    archivedAt: conv.archivedAt || null
  }
}

module.exports = { ConversationStore }


