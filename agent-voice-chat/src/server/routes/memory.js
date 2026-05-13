// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

const { Router } = require("express")
const { z } = require("zod")
const { validate } = require("../middleware/validate")

const AddMemorySchema = z.object({
  type: z.enum(["episodic", "semantic"]).default("episodic"),
  content: z.string().min(1).max(2000),
  speaker: z.string().max(100).optional(),
  spaceUrl: z.string().max(500).optional(),
  roomId: z.string().max(100).optional()
})

const AddUserFactsSchema = z.object({
  facts: z.array(z.string().min(1).max(500)).min(1).max(20)
})

/**
 * @param {object} deps
 * @param {import('../../../lib/memory-store').MemoryStore} deps.memoryStore
 */
module.exports = function createMemoryRoutes(deps) {
  const { memoryStore } = deps
  const router = Router()

  // ── GET /api/memory/stats ─────────────────────────────────────
  router.get("/stats", (req, res) => {
    res.success(memoryStore.getStats())
  })

  // ── GET /api/memory/memories ──────────────────────────────────
  router.get("/memories", (req, res) => {
    const opts = {}
    if (req.query.type) opts.type = req.query.type
    if (req.query.speaker) opts.speaker = req.query.speaker
    if (req.query.limit) opts.limit = parseInt(req.query.limit)

    const memories = memoryStore.getAllMemories(opts)
    // Strip embeddings from response to reduce payload
    const clean = memories.map(({ embedding, ...rest }) => rest)
    res.success(clean)
  })

  // ── POST /api/memory/memories ─────────────────────────────────
  router.post("/memories", validate(AddMemorySchema), async (req, res) => {
    try {
      const memory = await memoryStore.addMemory(req.body)
      const { embedding, ...clean } = memory
      res.success(clean, 201)
    } catch (err) {
      res.fail("INTERNAL_ERROR", err.message, 500)
    }
  })

  // ── POST /api/memory/search ───────────────────────────────────
  router.post("/search", async (req, res) => {
    const { query, speaker, type, limit, threshold } = req.body || {}
    if (!query || typeof query !== "string") {
      return res.fail("VALIDATION_ERROR", "query is required", 400)
    }
    try {
      const results = await memoryStore.searchMemories(query, { speaker, type, limit, threshold })
      const clean = results.map(({ embedding, ...rest }) => rest)
      res.success(clean)
    } catch (err) {
      res.fail("INTERNAL_ERROR", err.message, 500)
    }
  })

  // ── DELETE /api/memory/memories/:id ───────────────────────────
  router.delete("/memories/:id", (req, res) => {
    const deleted = memoryStore.deleteMemory(req.params.id)
    if (!deleted) return res.fail("NOT_FOUND", "Memory not found", 404)
    res.success({ deleted: true, id: req.params.id })
  })

  // ── DELETE /api/memory/memories ────────────────────────────────
  router.delete("/memories", (req, res) => {
    memoryStore.clearMemories()
    res.success({ cleared: true })
  })

  // ── User Profiles ─────────────────────────────────────────────

  // ── GET /api/memory/users ─────────────────────────────────────
  router.get("/users", (req, res) => {
    res.success(memoryStore.getAllUserProfiles())
  })

  // ── GET /api/memory/users/:username ───────────────────────────
  router.get("/users/:username", (req, res) => {
    const profile = memoryStore.getUserProfile(req.params.username)
    if (!profile) return res.fail("NOT_FOUND", "User profile not found", 404)
    res.success(profile)
  })

  // ── POST /api/memory/users/:username/facts ────────────────────
  router.post("/users/:username/facts", validate(AddUserFactsSchema), (req, res) => {
    const profile = memoryStore.addUserFacts(req.params.username, req.body.facts)
    res.success(profile)
  })

  // ── DELETE /api/memory/users/:username ────────────────────────
  router.delete("/users/:username", (req, res) => {
    const deleted = memoryStore.deleteUserProfile(req.params.username)
    if (!deleted) return res.fail("NOT_FOUND", "User profile not found", 404)
    res.success({ deleted: true, username: req.params.username })
  })

  // ── DELETE /api/memory/users ──────────────────────────────────
  router.delete("/users", (req, res) => {
    memoryStore.clearUserProfiles()
    res.success({ cleared: true })
  })

  return router
}
