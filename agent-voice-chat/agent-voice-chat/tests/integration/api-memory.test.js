// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import request from "supertest"
import createMemoryRoutes from "../../src/server/routes/memory.js"
import { createTestApp } from "../helpers/create-test-app.js"

/**
 * Create a lightweight in-memory mock of MemoryStore.
 * Avoids touching the filesystem, embeddings API, or logger.
 */
function createMockMemoryStore() {
  let memories = []
  let profiles = {}
  let nextId = 1

  return {
    getStats: vi.fn(() => ({ total: memories.length, episodic: 0, semantic: 0 })),

    getAllMemories: vi.fn((opts = {}) => {
      let result = [...memories]
      if (opts.type) result = result.filter(m => m.type === opts.type)
      if (opts.speaker) result = result.filter(m => m.speaker === opts.speaker)
      if (opts.limit) result = result.slice(-opts.limit)
      return result
    }),

    addMemory: vi.fn(async (data) => {
      const mem = {
        id: `mem_${nextId++}`,
        type: data.type || "episodic",
        content: data.content,
        speaker: data.speaker || null,
        spaceUrl: data.spaceUrl || null,
        roomId: data.roomId || null,
        createdAt: new Date().toISOString(),
        embedding: [0.1, 0.2, 0.3]
      }
      memories.push(mem)
      return mem
    }),

    searchMemories: vi.fn(async (query, opts = {}) => {
      if (!query) return []
      return memories
        .filter(m => m.content.toLowerCase().includes(query.toLowerCase()))
        .map(m => ({ ...m, score: 0.9 }))
    }),

    deleteMemory: vi.fn((id) => {
      const idx = memories.findIndex(m => m.id === id)
      if (idx === -1) return false
      memories.splice(idx, 1)
      return true
    }),

    clearMemories: vi.fn(() => { memories = [] }),

    getAllUserProfiles: vi.fn(() => Object.values(profiles)),

    getUserProfile: vi.fn((username) => profiles[username] || null),

    addUserFacts: vi.fn((username, facts) => {
      if (!profiles[username]) {
        profiles[username] = { username, facts: [], firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), interactions: 0 }
      }
      for (const f of facts) {
        if (!profiles[username].facts.includes(f)) profiles[username].facts.push(f)
      }
      return profiles[username]
    }),

    deleteUserProfile: vi.fn((username) => {
      if (!profiles[username]) return false
      delete profiles[username]
      return true
    }),

    clearUserProfiles: vi.fn(() => { profiles = {} }),

    // Expose for seeding in tests
    _memories: () => memories,
    _profiles: () => profiles
  }
}

describe("Memory API routes", () => {
  let app, memoryStore, ctx

  beforeEach(() => {
    ctx = createTestApp()
    app = ctx.app
    memoryStore = createMockMemoryStore()
    const memoryRouter = createMemoryRoutes({ memoryStore })
    app.use("/api/memory", memoryRouter)
  })

  afterEach(() => {
    ctx.roomManager.destroy()
  })

  // ── GET /api/memory/stats ─────────────────────────────────────

  describe("GET /api/memory/stats", () => {
    it("returns memory statistics", async () => {
      const res = await request(app).get("/api/memory/stats")
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveProperty("total")
      expect(memoryStore.getStats).toHaveBeenCalled()
    })
  })

  // ── GET /api/memory/memories ──────────────────────────────────

  describe("GET /api/memory/memories", () => {
    beforeEach(async () => {
      await memoryStore.addMemory({ type: "episodic", content: "Had coffee", speaker: "alice" })
      await memoryStore.addMemory({ type: "semantic", content: "Sky is blue", speaker: "bob" })
    })

    it("lists all memories", async () => {
      const res = await request(app).get("/api/memory/memories")
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data.length).toBe(2)
    })

    it("filters memories by type", async () => {
      const res = await request(app).get("/api/memory/memories?type=episodic")
      expect(res.status).toBe(200)
      expect(res.body.data.every(m => m.type === "episodic")).toBe(true)
    })

    it("filters memories by speaker", async () => {
      const res = await request(app).get("/api/memory/memories?speaker=alice")
      expect(res.status).toBe(200)
      expect(res.body.data.every(m => m.speaker === "alice")).toBe(true)
    })

    it("respects limit parameter", async () => {
      const res = await request(app).get("/api/memory/memories?limit=1")
      expect(res.status).toBe(200)
      expect(res.body.data.length).toBe(1)
    })

    it("strips embeddings from response", async () => {
      const res = await request(app).get("/api/memory/memories")
      expect(res.status).toBe(200)
      res.body.data.forEach(m => {
        expect(m).not.toHaveProperty("embedding")
      })
    })
  })

  // ── POST /api/memory/memories ─────────────────────────────────

  describe("POST /api/memory/memories", () => {
    it("adds a new episodic memory", async () => {
      const res = await request(app)
        .post("/api/memory/memories")
        .send({ type: "episodic", content: "The user mentioned their dog is named Rex." })
      expect(res.status).toBe(201)
      expect(res.body.data.id).toBeDefined()
      expect(res.body.data.content).toBe("The user mentioned their dog is named Rex.")
      expect(res.body.data.type).toBe("episodic")
    })

    it("adds a semantic memory", async () => {
      const res = await request(app)
        .post("/api/memory/memories")
        .send({ content: "Water boils at 100°C at sea level.", type: "semantic" })
      expect(res.status).toBe(201)
      expect(res.body.data.type).toBe("semantic")
    })

    it("strips embeddings from the response", async () => {
      const res = await request(app)
        .post("/api/memory/memories")
        .send({ content: "Test embedding strip." })
      expect(res.status).toBe(201)
      expect(res.body.data).not.toHaveProperty("embedding")
    })

    it("returns 400 when content is empty", async () => {
      const res = await request(app)
        .post("/api/memory/memories")
        .send({ content: "" })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe("VALIDATION_ERROR")
    })

    it("returns 400 when content is missing", async () => {
      const res = await request(app)
        .post("/api/memory/memories")
        .send({})
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe("VALIDATION_ERROR")
    })

    it("returns 400 when type is invalid", async () => {
      const res = await request(app)
        .post("/api/memory/memories")
        .send({ content: "Some content", type: "invalid-type" })
      expect(res.status).toBe(400)
    })

    it("returns 400 when content exceeds max length", async () => {
      const res = await request(app)
        .post("/api/memory/memories")
        .send({ content: "x".repeat(2001) })
      expect(res.status).toBe(400)
    })

    it("handles store errors gracefully", async () => {
      memoryStore.addMemory.mockRejectedValue(new Error("Store failed"))
      const res = await request(app)
        .post("/api/memory/memories")
        .send({ content: "Trigger failure." })
      expect(res.status).toBe(500)
      expect(res.body.error.code).toBe("INTERNAL_ERROR")
    })
  })

  // ── POST /api/memory/search ───────────────────────────────────

  describe("POST /api/memory/search", () => {
    beforeEach(async () => {
      await memoryStore.addMemory({ content: "The cat sat on the mat." })
      await memoryStore.addMemory({ content: "Dogs love to fetch balls." })
    })

    it("returns matching memories for a query", async () => {
      const res = await request(app)
        .post("/api/memory/search")
        .send({ query: "cat" })
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
    })

    it("returns relevant results (mock returns items containing the query string)", async () => {
      const res = await request(app)
        .post("/api/memory/search")
        .send({ query: "cat" })
      expect(res.status).toBe(200)
      expect(res.body.data.length).toBeGreaterThanOrEqual(1)
      expect(res.body.data[0].content).toContain("cat")
    })

    it("strips embeddings from search results", async () => {
      const res = await request(app)
        .post("/api/memory/search")
        .send({ query: "cat" })
      expect(res.status).toBe(200)
      res.body.data.forEach(m => expect(m).not.toHaveProperty("embedding"))
    })

    it("returns 400 when query is missing", async () => {
      const res = await request(app)
        .post("/api/memory/search")
        .send({})
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe("VALIDATION_ERROR")
    })

    it("returns 400 when query is empty string", async () => {
      const res = await request(app)
        .post("/api/memory/search")
        .send({ query: "" })
      expect(res.status).toBe(400)
    })

    it("handles store search errors gracefully", async () => {
      memoryStore.searchMemories.mockRejectedValue(new Error("Search blew up"))
      const res = await request(app)
        .post("/api/memory/search")
        .send({ query: "anything" })
      expect(res.status).toBe(500)
      expect(res.body.error.code).toBe("INTERNAL_ERROR")
    })
  })

  // ── DELETE /api/memory/memories/:id ───────────────────────────

  describe("DELETE /api/memory/memories/:id", () => {
    let memId

    beforeEach(async () => {
      const mem = await memoryStore.addMemory({ content: "To be deleted." })
      memId = mem.id
    })

    it("deletes an existing memory", async () => {
      const res = await request(app).delete(`/api/memory/memories/${memId}`)
      expect(res.status).toBe(200)
      expect(res.body.data.deleted).toBe(true)
      expect(res.body.data.id).toBe(memId)
    })

    it("returns 404 for a non-existent memory", async () => {
      const res = await request(app).delete("/api/memory/memories/no-such-id")
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe("NOT_FOUND")
    })
  })

  // ── DELETE /api/memory/memories ────────────────────────────────

  describe("DELETE /api/memory/memories (clear all)", () => {
    it("clears all memories", async () => {
      await memoryStore.addMemory({ content: "Memory 1" })
      await memoryStore.addMemory({ content: "Memory 2" })

      const res = await request(app).delete("/api/memory/memories")
      expect(res.status).toBe(200)
      expect(res.body.data.cleared).toBe(true)
      expect(memoryStore.clearMemories).toHaveBeenCalled()
    })
  })

  // ── User Profiles ─────────────────────────────────────────────

  describe("GET /api/memory/users", () => {
    it("returns all user profiles", async () => {
      memoryStore.addUserFacts("alice", ["Likes coffee"])
      const res = await request(app).get("/api/memory/users")
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
    })
  })

  describe("GET /api/memory/users/:username", () => {
    it("returns a user profile by username", async () => {
      memoryStore.addUserFacts("bob", ["Has a dog"])
      const res = await request(app).get("/api/memory/users/bob")
      expect(res.status).toBe(200)
      expect(res.body.data.username).toBe("bob")
    })

    it("returns 404 for an unknown user", async () => {
      const res = await request(app).get("/api/memory/users/unknown-person")
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe("NOT_FOUND")
    })
  })

  describe("POST /api/memory/users/:username/facts", () => {
    it("adds facts to a user profile", async () => {
      const res = await request(app)
        .post("/api/memory/users/charlie/facts")
        .send({ facts: ["Speaks Spanish", "Lives in Madrid"] })
      expect(res.status).toBe(200)
      expect(res.body.data.facts).toContain("Speaks Spanish")
    })

    it("returns 400 when facts array is empty", async () => {
      const res = await request(app)
        .post("/api/memory/users/charlie/facts")
        .send({ facts: [] })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe("VALIDATION_ERROR")
    })

    it("returns 400 when facts is not provided", async () => {
      const res = await request(app)
        .post("/api/memory/users/charlie/facts")
        .send({})
      expect(res.status).toBe(400)
    })
  })

  describe("DELETE /api/memory/users/:username", () => {
    it("deletes an existing user profile", async () => {
      memoryStore.addUserFacts("dave", ["Some fact"])
      const res = await request(app).delete("/api/memory/users/dave")
      expect(res.status).toBe(200)
      expect(res.body.data.deleted).toBe(true)
      expect(res.body.data.username).toBe("dave")
    })

    it("returns 404 for an unknown user", async () => {
      const res = await request(app).delete("/api/memory/users/ghost")
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe("NOT_FOUND")
    })
  })

  describe("DELETE /api/memory/users (clear all)", () => {
    it("clears all user profiles", async () => {
      memoryStore.addUserFacts("alice", ["fact1"])
      const res = await request(app).delete("/api/memory/users")
      expect(res.status).toBe(200)
      expect(res.body.data.cleared).toBe(true)
      expect(memoryStore.clearUserProfiles).toHaveBeenCalled()
    })
  })
})


