// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { describeE2E, measureLatency, HAS_ANY_LLM_KEY } from "./setup.js"

describeE2E("Memory & RAG", () => {
  let MemoryStore, KnowledgeBase
  let tempDir

  beforeAll(async () => {
    MemoryStore = (await import("../../lib/memory-store.js")).default || require("../../lib/memory-store.js")
    KnowledgeBase = (await import("../../lib/knowledge-base.js")).default || require("../../lib/knowledge-base.js")
  })

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-memory-"))
  })

  afterAll(() => {
    // Clean up temp dirs
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("should store and retrieve memories by semantic similarity", async () => {
    const store = new MemoryStore({ storagePath: tempDir })

    // Store some memories
    const memory1 = await store.addMemory({
      type: "episodic",
      content: "Alice mentioned she works at Acme Corp as a software engineer",
      context: { speaker: "alice", topic: "work" },
    })
    expect(memory1).toHaveProperty("id")

    const memory2 = await store.addMemory({
      type: "episodic",
      content: "Bob said his favorite programming language is Rust",
      context: { speaker: "bob", topic: "programming" },
    })
    expect(memory2).toHaveProperty("id")

    // Search for related memories
    const { result: results, latencyMs } = await measureLatency(async () => {
      return store.searchMemories("What does Alice do for work?", { limit: 5 })
    })

    expect(results.length).toBeGreaterThan(0)
    // The most relevant result should mention Alice/Acme
    const topResult = results[0]
    expect(topResult.content.toLowerCase()).toContain("alice")

    console.log(`[E2E] Memory search: found ${results.length} results (${latencyMs}ms), top: "${topResult.content.slice(0, 60)}..."`)
  })

  it("should maintain user profiles", async () => {
    const store = new MemoryStore({ storagePath: tempDir })

    store.updateUserProfile("testuser", {
      name: "Test User",
      preferences: { language: "English" },
      facts: ["Lives in San Francisco"],
    })

    const profile = store.getUserProfile("testuser")
    expect(profile).toBeTruthy()
    expect(profile.name).toBe("Test User")
    expect(profile.facts).toContain("Lives in San Francisco")

    console.log(`[E2E] User profile: ${JSON.stringify(profile)}`)
  })

  it("should persist memories to disk and reload", async () => {
    const store1 = new MemoryStore({ storagePath: tempDir })

    await store1.addMemory({
      type: "semantic",
      content: "The project uses React for the frontend",
      context: { topic: "technology" },
    })

    // Create a new instance that loads from disk
    const store2 = new MemoryStore({ storagePath: tempDir })
    const memories = store2.getAllMemories()

    expect(memories.length).toBeGreaterThan(0)
    expect(memories.some(m => m.content.includes("React"))).toBe(true)

    console.log(`[E2E] Memory persistence: ${memories.length} memories reloaded from disk`)
  })

  it("should index and search knowledge base documents", async () => {
    const knowledgePath = path.join(tempDir, "knowledge")
    fs.mkdirSync(knowledgePath, { recursive: true })

    // Create a test document
    const docContent = `# Agent Voice Chat Architecture

The system uses WebSocket connections for real-time communication.
Each agent has its own personality and voice settings.
The turn manager handles who speaks next in multi-agent conversations.
Memory is stored using vector embeddings for semantic search.
`
    fs.writeFileSync(path.join(knowledgePath, "architecture.md"), docContent)

    const kb = new KnowledgeBase({
      knowledgePath,
      indexPath: path.join(tempDir, "kb-index.json"),
    })

    // Index documents
    const { latencyMs: indexLatency } = await measureLatency(async () => {
      await kb.indexDocuments()
    })
    console.log(`[E2E] KB indexing: ${indexLatency}ms`)

    // Search
    const { result: results, latencyMs: searchLatency } = await measureLatency(async () => {
      return kb.search("How does the turn manager work?", { limit: 3 })
    })

    expect(results.length).toBeGreaterThan(0)
    // Should find the relevant chunk about turn management
    const found = results.some(r =>
      r.content.toLowerCase().includes("turn") || r.content.toLowerCase().includes("speaks")
    )
    expect(found).toBe(true)

    console.log(`[E2E] KB search: ${results.length} results (${searchLatency}ms)`)

    // Stats
    const stats = kb.getStats()
    expect(stats.documents).toBeGreaterThan(0)
    expect(stats.chunks).toBeGreaterThan(0)

    console.log(`[E2E] KB stats: ${stats.documents} docs, ${stats.chunks} chunks`)
  })
})


