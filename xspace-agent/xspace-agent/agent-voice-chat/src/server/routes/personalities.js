// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { Router } = require("express")
const { z } = require("zod")
const { validate } = require("../middleware/validate")
const { nanoid } = require("nanoid")
const { logger } = require("../logger")

const MAX_PERSONALITIES = parseInt(process.env.MAX_PERSONALITIES, 10) || 500

const PersonalitySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().default(""),
  prompt: z.string().min(1).max(10000),
  voice: z.string().optional(),
  tags: z.array(z.string().max(50)).max(10).optional().default([])
})

const UpdatePersonalitySchema = PersonalitySchema.partial()

/**
 * Personality CRUD routes.
 * In-memory store for personality presets that can be assigned to agents.
 */
module.exports = function createPersonalityRoutes() {
  const router = Router()

  // In-memory personality store
  const personalities = new Map()

  // Expose store for agent routes
  router._store = {
    get(id) { return personalities.get(id) || null },
    getAll() { return Array.from(personalities.values()) }
  }

  // ── GET /api/personalities ─────────────────────────────────────
  router.get("/", (req, res) => {
    const data = Array.from(personalities.values()).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      tags: p.tags,
      voice: p.voice || null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    }))
    res.success(data)
  })

  // ── GET /api/personalities/:id ─────────────────────────────────
  router.get("/:id", (req, res) => {
    const p = personalities.get(req.params.id)
    if (!p) {
      return res.fail("NOT_FOUND", "Personality not found", 404)
    }
    res.success(p)
  })

  // ── POST /api/personalities ────────────────────────────────────
  router.post("/", validate(PersonalitySchema), (req, res) => {
    // Evict the oldest personality when at capacity
    if (personalities.size >= MAX_PERSONALITIES) {
      const oldestKey = personalities.keys().next().value
      personalities.delete(oldestKey)
      logger.warn({ maxPersonalities: MAX_PERSONALITIES }, "Personality store at capacity, evicting oldest")
    }

    const id = nanoid(10)
    const personality = {
      id,
      ...req.body,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    personalities.set(id, personality)
    res.success(personality, 201)
  })

  // ── PUT /api/personalities/:id ─────────────────────────────────
  router.put("/:id", validate(UpdatePersonalitySchema), (req, res) => {
    const p = personalities.get(req.params.id)
    if (!p) {
      return res.fail("NOT_FOUND", "Personality not found", 404)
    }

    const updated = { ...p, ...req.body, updatedAt: Date.now() }
    personalities.set(req.params.id, updated)
    res.success(updated)
  })

  // ── DELETE /api/personalities/:id ──────────────────────────────
  router.delete("/:id", (req, res) => {
    if (!personalities.has(req.params.id)) {
      return res.fail("NOT_FOUND", "Personality not found", 404)
    }
    personalities.delete(req.params.id)
    res.success({ deleted: true })
  })

  return router
}


