// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { Router } = require("express")
const { z } = require("zod")
const { validate } = require("../middleware/validate")

const RollbackSchema = z.object({
  version: z.number().int().positive()
})

/**
 * Memory admin routes for per-agent memory management.
 * Provides versioning, rollback, stats, and cross-agent operations.
 *
 * @param {object} deps
 * @param {Map<string, import('../../../lib/memory-store').MemoryStore>} deps.memoryStores - Map of agentId → MemoryStore
 */
module.exports = function createMemoryAdminRoutes(deps) {
  const { memoryStores } = deps
  const router = Router()

  /**
   * Resolve a MemoryStore for the given agentId.
   * Returns null if not found.
   */
  function getStore(agentId) {
    return memoryStores.get(agentId) || null
  }

  // ── GET /api/memory-admin/:agentId ────────────────────────────
  // List memories for agent
  router.get("/:agentId", (req, res) => {
    const store = getStore(req.params.agentId)
    if (!store) return res.fail("NOT_FOUND", `No memory store for agent "${req.params.agentId}"`, 404)

    const opts = {}
    if (req.query.type) opts.type = req.query.type
    if (req.query.speaker) opts.speaker = req.query.speaker
    if (req.query.limit) opts.limit = parseInt(req.query.limit)

    const memories = store.getAllMemories(opts)
    const clean = memories.map(({ embedding, ...rest }) => rest)
    res.success(clean)
  })

  // ── GET /api/memory-admin/:agentId/search ─────────────────────
  // Semantic search within agent's memories
  router.post("/:agentId/search", async (req, res) => {
    const store = getStore(req.params.agentId)
    if (!store) return res.fail("NOT_FOUND", `No memory store for agent "${req.params.agentId}"`, 404)

    const { query, speaker, type, limit, threshold } = req.body || {}
    if (!query || typeof query !== "string") {
      return res.fail("VALIDATION_ERROR", "query is required", 400)
    }

    try {
      const results = await store.searchMemories(query, { speaker, type, limit, threshold })
      const clean = results.map(({ embedding, ...rest }) => rest)
      res.success(clean)
    } catch (err) {
      res.fail("INTERNAL_ERROR", err.message, 500)
    }
  })

  // ── DELETE /api/memory-admin/:agentId/:id ─────────────────────
  // Delete specific memory
  router.delete("/:agentId/:id", (req, res) => {
    const store = getStore(req.params.agentId)
    if (!store) return res.fail("NOT_FOUND", `No memory store for agent "${req.params.agentId}"`, 404)

    const deleted = store.deleteMemory(req.params.id)
    if (!deleted) return res.fail("NOT_FOUND", "Memory not found", 404)
    res.success({ deleted: true, id: req.params.id })
  })

  // ── GET /api/memory-admin/:agentId/stats ──────────────────────
  // Memory statistics for agent
  router.get("/:agentId/stats", (req, res) => {
    const store = getStore(req.params.agentId)
    if (!store) return res.fail("NOT_FOUND", `No memory store for agent "${req.params.agentId}"`, 404)
    res.success(store.getStats())
  })

  // ── GET /api/memory-admin/:agentId/versions ───────────────────
  // List available memory versions
  router.get("/:agentId/versions", (req, res) => {
    const store = getStore(req.params.agentId)
    if (!store) return res.fail("NOT_FOUND", `No memory store for agent "${req.params.agentId}"`, 404)

    const versions = store.listVersions()
    res.success(versions.map(v => ({ version: v, date: new Date(v).toISOString() })))
  })

  // ── POST /api/memory-admin/:agentId/version ───────────────────
  // Create a new memory version (snapshot)
  router.post("/:agentId/version", async (req, res) => {
    const store = getStore(req.params.agentId)
    if (!store) return res.fail("NOT_FOUND", `No memory store for agent "${req.params.agentId}"`, 404)

    const version = await store.createVersion()
    if (!version) return res.fail("INTERNAL_ERROR", "Failed to create version", 500)
    res.success({ version, date: new Date(version).toISOString() }, 201)
  })

  // ── POST /api/memory-admin/:agentId/rollback ──────────────────
  // Rollback to a specific memory version
  router.post("/:agentId/rollback", validate(RollbackSchema), (req, res) => {
    const store = getStore(req.params.agentId)
    if (!store) return res.fail("NOT_FOUND", `No memory store for agent "${req.params.agentId}"`, 404)

    const success = store.rollback(req.body.version)
    if (!success) return res.fail("NOT_FOUND", `Version ${req.body.version} not found`, 404)
    res.success({ rolledBack: true, version: req.body.version })
  })

  // ── POST /api/memory-admin/:agentId/prune ─────────────────────
  // Force prune expired memories
  router.post("/:agentId/prune", (req, res) => {
    const store = getStore(req.params.agentId)
    if (!store) return res.fail("NOT_FOUND", `No memory store for agent "${req.params.agentId}"`, 404)

    const pruned = store.pruneExpired()
    res.success({ pruned })
  })

  return router
}


