// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { Router } = require("express")
const path = require("path")
const fs = require("fs")

/**
 * @param {object} deps
 * @param {import('../../../lib/knowledge-base').KnowledgeBase} deps.knowledgeBase
 */
module.exports = function createKnowledgeRoutes(deps) {
  const { knowledgeBase } = deps
  const router = Router()

  // ── GET /api/knowledge/stats ──────────────────────────────────
  router.get("/stats", (req, res) => {
    res.success(knowledgeBase.getStats())
  })

  // ── GET /api/knowledge/documents ──────────────────────────────
  router.get("/documents", (req, res) => {
    res.success(knowledgeBase.listDocuments())
  })

  // ── POST /api/knowledge/ingest ────────────────────────────────
  // Ingest a specific file from the knowledge directory
  router.post("/ingest", async (req, res) => {
    const { filename } = req.body || {}
    if (!filename || typeof filename !== "string") {
      return res.fail("VALIDATION_ERROR", "filename is required", 400)
    }

    // Prevent path traversal
    const safeName = path.basename(filename)
    const filePath = path.join(knowledgeBase.directory, safeName)

    if (!fs.existsSync(filePath)) {
      return res.fail("NOT_FOUND", `File not found: ${safeName}`, 404)
    }

    try {
      const result = await knowledgeBase.ingestDocument(filePath)
      res.success(result)
    } catch (err) {
      res.fail("INTERNAL_ERROR", err.message, 500)
    }
  })

  // ── POST /api/knowledge/ingest-all ────────────────────────────
  // Ingest all documents from the knowledge directory
  router.post("/ingest-all", async (req, res) => {
    try {
      const result = await knowledgeBase.ingestAll()
      res.success(result)
    } catch (err) {
      res.fail("INTERNAL_ERROR", err.message, 500)
    }
  })

  // ── POST /api/knowledge/search ────────────────────────────────
  router.post("/search", async (req, res) => {
    const { query, limit, threshold, docName } = req.body || {}
    if (!query || typeof query !== "string") {
      return res.fail("VALIDATION_ERROR", "query is required", 400)
    }

    try {
      const results = await knowledgeBase.search(query, { limit, threshold, docName })
      res.success(results)
    } catch (err) {
      res.fail("INTERNAL_ERROR", err.message, 500)
    }
  })

  // ── DELETE /api/knowledge/documents/:name ─────────────────────
  router.delete("/documents/:name", (req, res) => {
    const docName = req.params.name
    const docs = knowledgeBase.listDocuments()
    if (!docs.find(d => d.name === docName)) {
      return res.fail("NOT_FOUND", "Document not found in index", 404)
    }
    knowledgeBase.removeDocument(docName)
    res.success({ deleted: true, name: docName })
  })

  // ── DELETE /api/knowledge ─────────────────────────────────────
  router.delete("/", (req, res) => {
    knowledgeBase.clearIndex()
    res.success({ cleared: true })
  })

  // ── GET /api/knowledge/files ──────────────────────────────────
  // List files available in the knowledge directory (not yet indexed)
  router.get("/files", (req, res) => {
    try {
      if (!fs.existsSync(knowledgeBase.directory)) {
        return res.success([])
      }
      const files = fs.readdirSync(knowledgeBase.directory).map(name => {
        const filePath = path.join(knowledgeBase.directory, name)
        const stat = fs.statSync(filePath)
        const indexed = !!knowledgeBase.documents[name]
        return { name, size: stat.size, indexed, modifiedAt: stat.mtime.toISOString() }
      })
      res.success(files)
    } catch (err) {
      res.fail("INTERNAL_ERROR", err.message, 500)
    }
  })

  return router
}


