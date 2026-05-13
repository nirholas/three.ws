// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require("../constants")
const { Router } = require("express")
const { ConversationStore } = require("../../../lib/conversation-store")
const { logger } = require("../logger")

/** Maximum search query length to prevent expensive linear scans. */
const SEARCH_MAX_LENGTH = 200
/** Maximum number of messages to scan per conversation during search. */
const SEARCH_MAX_MESSAGES = 100
/** Maximum number of messages fed to the LLM for summarisation. */
const SUMMARY_MAX_MESSAGES = 200
/** Minimum messages required before a summary is allowed. */
const SUMMARY_MIN_MESSAGES = 10

// ── Transcript helpers ──────────────────────────────────────────────

/** Remove characters unsafe for filenames and trim to maxLen. */
function sanitizeFilename(str, maxLen = 80) {
  return (str || "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, maxLen) || "conversation"
}

function formatMarkdown(conv) {
  const lines = [
    `# ${conv.title}`,
    "",
    `**Started:** ${new Date(conv.startedAt).toISOString()}  `,
    `**Ended:** ${new Date(conv.endedAt).toISOString()}  `,
    `**Agents:** ${(conv.agentIds || []).join(", ")}  `,
    `**Messages:** ${conv.messageCount}`
  ]
  if (conv.tags && conv.tags.length > 0) {
    lines.push("", `**Tags:** ${conv.tags.join(", ")}`)
  }
  lines.push("", "---", "")
  for (const m of conv.messages || []) {
    const time = new Date(m.timestamp).toISOString()
    const speaker = m.isUser ? (m.name || "User") : (m.name || `Agent ${m.agentId}`)
    lines.push(`**[${time}] ${speaker}:**`, "", m.text || "", "")
  }
  return lines.join("\n")
}

function formatCsv(conv) {
  const esc = (v) => {
    if (v == null) return ""
    return `"${String(v).replace(/"/g, '""')}"`
  }
  const rows = [["timestamp", "speaker", "role", "agentId", "text"].join(",")]
  for (const m of conv.messages || []) {
    const time = new Date(m.timestamp).toISOString()
    const speaker = m.isUser ? (m.name || "User") : (m.name || `Agent ${m.agentId}`)
    const role = m.isUser ? "user" : "agent"
    rows.push([esc(time), esc(speaker), esc(role), esc(m.agentId), esc(m.text)].join(","))
  }
  return rows.join("\n")
}

// ── Import validation ───────────────────────────────────────────────

function validateConversation(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "Must be a plain object"
  if (!obj.title || typeof obj.title !== "string") return "Missing or invalid title"
  if (!Array.isArray(obj.messages)) return "Missing or invalid messages array"
  if (!Array.isArray(obj.agentIds)) return "Missing or invalid agentIds array"
  if (typeof obj.messageCount !== "number") return "Missing or invalid messageCount"
  if (typeof obj.createdAt !== "number") return "Missing or invalid createdAt"
  return null
}

// ── Route factory ───────────────────────────────────────────────────

/**
 * Conversation routes: persistence, search, export, archival, tags, import, and summarisation.
 *
 * @param {object} deps
 * @param {object} deps.spaceState      - shared server state (`.messages` array)
 * @param {object} [deps.provider]      - LLM provider for summarisation
 * @param {string} [deps.dataDir]       - base data directory; persistence is
 *                                        disabled when omitted (tests / default)
 */
module.exports = function createConversationRoutes(deps) {
  const { spaceState, provider, dataDir } = deps
  const router = Router()

  const storeDir = dataDir ? require("path").join(dataDir, "conversations") : null
  const store = new ConversationStore(storeDir)

  // Load persisted conversations on startup (non-blocking; errors only logged)
  store.load().catch(err => logger.error({ err: err.message }, "Failed to load conversation store"))

  let _nextId = 1
  function generateId() {
    return `${Date.now()}-${_nextId++}`
  }

  /** Snapshot current space messages as a new conversation and persist it. */
  function archiveConversation(metadata = {}) {
    if (spaceState.messages.length === 0) return null
    const id = generateId()
    const conv = {
      id,
      title: metadata.title || `Conversation ${id}`,
      messages: [...spaceState.messages],
      agentIds: [...new Set(spaceState.messages.filter(m => m.agentId !== -1).map(m => m.agentId))],
      messageCount: spaceState.messages.length,
      startedAt: spaceState.messages[0]?.timestamp || Date.now(),
      endedAt: spaceState.messages[spaceState.messages.length - 1]?.timestamp || Date.now(),
      createdAt: Date.now(),
      tags: [],
      summary: null,
      summaryAt: null
    }
    store.save(id, conv).catch(err => logger.error({ err: err.message, id }, "Failed to save conversation"))
    return conv
  }

  // Expose for external callers (e.g. tests, room cleanup)
  router._archiveConversation = archiveConversation
  router._conversations = store.cache   // backward-compat alias
  router._store = store

  // ── GET /api/conversations/stats ────────────────────────────────
  router.get("/stats", (req, res) => {
    const allConvs = store.list()
    const totalMessages = allConvs.reduce((sum, c) => sum + c.messageCount, 0)
    const agentSet = new Set()
    allConvs.forEach(c => c.agentIds.forEach(id => agentSet.add(id)))
    const sorted = allConvs.slice().sort((a, b) => a.createdAt - b.createdAt)

    res.success({
      totalConversations: allConvs.length,
      archivedConversations: store.listArchived().length,
      totalMessages,
      uniqueAgents: agentSet.size,
      currentSessionMessages: spaceState.messages.length,
      oldestConversation: sorted.length > 0 ? sorted[0].createdAt : null,
      newestConversation: sorted.length > 0 ? sorted[sorted.length - 1].createdAt : null
    })
  })

  // ── GET /api/conversations/archived ─────────────────────────────
  router.get("/archived", (req, res) => {
    const parsedLimit = Number(req.query.limit)
    const limit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    const offset = Math.max(parseInt(req.query.offset) || 0, 0)
    const archived = store.listArchived().sort((a, b) => b.createdAt - a.createdAt)

    res.success({
      items: archived.slice(offset, offset + limit),
      total: archived.length,
      limit,
      offset
    })
  })

  // ── GET /api/conversations/archived/:id ─────────────────────────
  router.get("/archived/:id", async (req, res) => {
    if (!store.hasArchived(req.params.id)) {
      return res.fail("NOT_FOUND", "Archived conversation not found", 404)
    }
    try {
      const conv = await store.getArchived(req.params.id)
      res.success(conv)
    } catch {
      res.fail("INTERNAL_ERROR", "Failed to retrieve archived conversation", 500)
    }
  })

  // ── POST /api/conversations/import ──────────────────────────────
  router.post("/import", async (req, res) => {
    const body = req.body
    const items = Array.isArray(body)
      ? body
      : body && Array.isArray(body.conversations)
        ? body.conversations
        : body
          ? [body]
          : []

    if (items.length === 0) {
      return res.fail("VALIDATION_ERROR", "No conversations to import", 400)
    }

    const results = []
    const errors = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const err = validateConversation(item)
      if (err) { errors.push({ index: i, error: err }); continue }

      const newId = generateId()
      const conv = { ...item, id: newId, importedAt: Date.now(), tags: item.tags || [] }
      try {
        await store.save(newId, conv)
        results.push({ index: i, id: newId })
      } catch {
        errors.push({ index: i, error: "Storage write failed" })
      }
    }

    const status = results.length === 0 ? 400 : 207
    res.success({ imported: results.length, failed: errors.length, results, errors }, status)
  })

  // ── GET /api/conversations ───────────────────────────────────────
  router.get("/", (req, res) => {
    // Pagination — support both ?limit/?offset (legacy) and ?pageSize/?page
    const limit = Math.min(
      parseInt(req.query.limit) || parseInt(req.query.pageSize) || DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE
    )
    const page = Math.max(parseInt(req.query.page) || 1, 1)
    const offset = Math.max(parseInt(req.query.offset) || (page - 1) * limit, 0)
    const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null

    // Sort
    const sortBy = ["createdAt", "title", "messageCount"].includes(req.query.sort)
      ? req.query.sort
      : "createdAt"

    // Tag filter
    const tag = req.query.tag || null

    // Search — enforce length limit to prevent expensive scans
    const rawSearch = req.query.search ? req.query.search.trim() : null
    if (rawSearch && rawSearch.length > SEARCH_MAX_LENGTH) {
      return res.fail("VALIDATION_ERROR", `Search must be at most ${SEARCH_MAX_LENGTH} characters`, 400)
    }
    const search = rawSearch ? rawSearch.toLowerCase() : null

    let convList = store.list()

    if (tag) {
      convList = convList.filter(c => c.tags && c.tags.includes(tag))
    }

    if (search) {
      convList = convList.filter(c => {
        if (c.title.toLowerCase().includes(search)) return true
        return c.messages.slice(0, SEARCH_MAX_MESSAGES).some(m => m.text && m.text.toLowerCase().includes(search))
      })
    }

    if (sortBy === "title") {
      convList.sort((a, b) => a.title.localeCompare(b.title))
    } else if (sortBy === "messageCount") {
      convList.sort((a, b) => b.messageCount - a.messageCount)
    } else {
      convList.sort((a, b) => b.createdAt - a.createdAt)
    }

    // Cursor-based pagination (createdAt desc only)
    if (cursor !== null && sortBy === "createdAt") {
      convList = convList.filter(c => c.createdAt < cursor)
    }

    const total = convList.length
    const pageItems = convList.slice(offset, offset + limit)
    const nextCursor = pageItems.length === limit && sortBy === "createdAt"
      ? pageItems[pageItems.length - 1].createdAt
      : null

    const data = pageItems.map(c => ({
      id: c.id,
      title: c.title,
      agentIds: c.agentIds,
      messageCount: c.messageCount,
      tags: c.tags || [],
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      createdAt: c.createdAt
    }))

    res.success({ items: data, total, limit, offset, page, nextCursor })
  })

  // ── GET /api/conversations/:id ───────────────────────────────────
  router.get("/:id", (req, res) => {
    const conv = store.get(req.params.id)
    if (!conv) {
      return res.fail("NOT_FOUND", "Conversation not found", 404)
    }
    res.success(conv)
  })

  // ── GET /api/conversations/:id/transcript ────────────────────────
  router.get("/:id/transcript", async (req, res) => {
    const id = req.params.id
    let conv = store.get(id)

    if (!conv && store.hasArchived(id)) {
      try { conv = await store.getArchived(id) } catch {
        return res.fail("INTERNAL_ERROR", "Failed to retrieve archived conversation", 500)
      }
    }

    if (!conv) {
      return res.fail("NOT_FOUND", "Conversation not found", 404)
    }

    const format = req.query.format || "text"
    const safeName = sanitizeFilename(conv.title)

    if (format === "json") {
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.json"`)
      return res.success(conv)
    }

    if (format === "md") {
      res.setHeader("Content-Type", "text/markdown; charset=utf-8")
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.md"`)
      return res.send(formatMarkdown(conv))
    }

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8")
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.csv"`)
      return res.send(formatCsv(conv))
    }

    // Plain text (default) — keep original filename pattern for backward compatibility
    const lines = (conv.messages || []).map(m => {
      const time = new Date(m.timestamp).toISOString()
      const speaker = m.isUser ? (m.name || "User") : (m.name || `Agent ${m.agentId}`)
      return `[${time}] ${speaker}: ${m.text}`
    })
    res.setHeader("Content-Type", "text/plain; charset=utf-8")
    res.setHeader("Content-Disposition", `attachment; filename="conversation-${conv.id}.txt"`)
    res.send(lines.join("\n"))
  })

  // ── GET /api/conversations/:id/summary ───────────────────────────
  router.get("/:id/summary", async (req, res) => {
    const conv = store.get(req.params.id)
    if (!conv) {
      return res.fail("NOT_FOUND", "Conversation not found", 404)
    }

    if (conv.messageCount < SUMMARY_MIN_MESSAGES) {
      return res.fail("VALIDATION_ERROR", `Conversation must have at least ${SUMMARY_MIN_MESSAGES} messages to summarise`, 400)
    }

    // Return cached summary if still valid (generated after the last message)
    if (conv.summary && conv.summaryAt && conv.summaryAt >= conv.endedAt) {
      return res.success({ summary: conv.summary, cachedAt: conv.summaryAt, cached: true })
    }

    if (!provider) {
      return res.fail("PROVIDER_ERROR", "LLM provider not available for summarisation", 503)
    }

    try {
      const transcript = (conv.messages || [])
        .slice(0, SUMMARY_MAX_MESSAGES)
        .map(m => {
          const speaker = m.isUser ? (m.name || "User") : (m.name || `Agent ${m.agentId}`)
          return `${speaker}: ${m.text}`
        })
        .join("\n")

      const systemPrompt = "You are a helpful assistant. Summarise the following conversation concisely in 2-4 sentences, focusing on the main topics and outcomes."
      let summary = ""
      for await (const chunk of provider.streamResponse("__summarizer__", transcript, systemPrompt, "summary")) {
        summary += chunk
      }
      summary = summary.trim()

      const updated = { ...conv, summary, summaryAt: Date.now() }
      await store.save(conv.id, updated)

      res.success({ summary, cachedAt: updated.summaryAt, cached: false })
    } catch {
      res.fail("INTERNAL_ERROR", "Failed to generate summary", 500)
    }
  })

  // ── POST /api/conversations/:id/tags ─────────────────────────────
  router.post("/:id/tags", async (req, res) => {
    const conv = store.get(req.params.id)
    if (!conv) {
      return res.fail("NOT_FOUND", "Conversation not found", 404)
    }

    const { tags } = req.body || {}
    if (!Array.isArray(tags) || tags.some(t => typeof t !== "string")) {
      return res.fail("VALIDATION_ERROR", "Body must include a tags array of strings", 400)
    }

    const merged = [...new Set([...(conv.tags || []), ...tags.map(t => t.trim()).filter(Boolean)])]
    const updated = { ...conv, tags: merged }
    await store.save(conv.id, updated)

    res.success({ id: conv.id, tags: merged })
  })

  // ── DELETE /api/conversations/:id/tags/:tag ───────────────────────
  router.delete("/:id/tags/:tag", async (req, res) => {
    const conv = store.get(req.params.id)
    if (!conv) {
      return res.fail("NOT_FOUND", "Conversation not found", 404)
    }

    const tags = (conv.tags || []).filter(t => t !== req.params.tag)
    const updated = { ...conv, tags }
    await store.save(conv.id, updated)

    res.success({ id: conv.id, tags })
  })

  // ── POST /api/conversations/:id/archive ──────────────────────────
  router.post("/:id/archive", async (req, res) => {
    if (!store.has(req.params.id)) {
      return res.fail("NOT_FOUND", "Conversation not found", 404)
    }
    try {
      await store.archive(req.params.id)
      res.success({ archived: true, id: req.params.id })
    } catch (err) {
      res.fail("INTERNAL_ERROR", err.message, 500)
    }
  })

  // ── POST /api/conversations/:id/unarchive ─────────────────────────
  router.post("/:id/unarchive", async (req, res) => {
    if (!store.hasArchived(req.params.id)) {
      return res.fail("NOT_FOUND", "Archived conversation not found", 404)
    }
    try {
      await store.unarchive(req.params.id)
      res.success({ unarchived: true, id: req.params.id })
    } catch (err) {
      res.fail("INTERNAL_ERROR", err.message, 500)
    }
  })

  // ── DELETE /api/conversations/:id ────────────────────────────────
  router.delete("/:id", async (req, res) => {
    const deleted = await store.delete(req.params.id)
    if (!deleted) {
      return res.fail("NOT_FOUND", "Conversation not found", 404)
    }
    res.success({ deleted: true })
  })

  // ── POST /api/conversations — archive current session ─────────────
  router.post("/", (req, res) => {
    const conv = archiveConversation({ title: req.body?.title })
    if (!conv) {
      return res.fail("VALIDATION_ERROR", "No messages to archive", 400)
    }
    res.success(conv, 201)
  })

  return router
}
