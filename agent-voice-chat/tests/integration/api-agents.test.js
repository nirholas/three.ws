// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import request from "supertest"
import createAgentRoutes from "../../src/server/routes/agents.js"
import { createTestApp } from "../helpers/create-test-app.js"

describe("Agent API routes", () => {
  let app, registry, roomManager, ctx

  beforeEach(() => {
    ctx = createTestApp()
    app = ctx.app
    registry = ctx.registry
    roomManager = ctx.roomManager

    const agentRouter = createAgentRoutes({
      registry: ctx.registry,
      roomManager: ctx.roomManager,
      DEFAULT_ROOM_ID: ctx.DEFAULT_ROOM_ID,
      provider: ctx.provider,
      spaceNS: ctx.spaceNS
    })
    app.use("/api/agents", agentRouter)
  })

  afterEach(() => {
    roomManager.destroy()
  })

  describe("GET /api/agents", () => {
    it("should return all agents", async () => {
      const res = await request(app).get("/api/agents")
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(2)
      expect(res.body.data[0]).toHaveProperty("id")
      expect(res.body.data[0]).toHaveProperty("name")
      expect(res.body.data[0]).toHaveProperty("status")
    })
  })

  describe("GET /api/agents/:id", () => {
    it("should return a single agent", async () => {
      const res = await request(app).get("/api/agents/bob")
      expect(res.status).toBe(200)
      expect(res.body.data.id).toBe("bob")
      expect(res.body.data.name).toBe("Bob")
    })

    it("should return 404 for unknown agent", async () => {
      const res = await request(app).get("/api/agents/unknown")
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe("NOT_FOUND")
    })
  })

  describe("POST /api/agents", () => {
    it("should create a new agent", async () => {
      const res = await request(app)
        .post("/api/agents")
        .send({ id: "alex", name: "Alex", personality: "Friendly" })

      expect(res.status).toBe(201)
      expect(res.body.data.id).toBe("alex")
      expect(res.body.data.name).toBe("Alex")
    })

    it("should return 409 for duplicate agent id", async () => {
      const res = await request(app)
        .post("/api/agents")
        .send({ id: "bob", name: "Bob2" })

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe("CONFLICT")
    })

    it("should validate required fields", async () => {
      const res = await request(app)
        .post("/api/agents")
        .send({ name: "No ID" })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe("VALIDATION_ERROR")
    })

    it("should validate id format (lowercase alphanumeric)", async () => {
      const res = await request(app)
        .post("/api/agents")
        .send({ id: "UPPER CASE!", name: "Bad" })

      expect(res.status).toBe(400)
    })
  })

  describe("PUT /api/agents/:id", () => {
    it("should update agent properties", async () => {
      const res = await request(app)
        .put("/api/agents/bob")
        .send({ name: "Robert" })

      expect(res.status).toBe(200)
      expect(res.body.data.name).toBe("Robert")
    })

    it("should return 404 for unknown agent", async () => {
      const res = await request(app)
        .put("/api/agents/unknown")
        .send({ name: "X" })

      expect(res.status).toBe(404)
    })
  })

  describe("DELETE /api/agents/:id", () => {
    it("should delete an agent", async () => {
      const res = await request(app).delete("/api/agents/bob")
      expect(res.status).toBe(200)
      expect(res.body.data.deleted).toBe(true)

      // Verify it's gone
      const check = await request(app).get("/api/agents/bob")
      expect(check.status).toBe(404)
    })

    it("should return 404 for unknown agent", async () => {
      const res = await request(app).delete("/api/agents/unknown")
      expect(res.status).toBe(404)
    })

    it("should clean up turn state on delete", async () => {
      const room = roomManager.getRoom(ctx.DEFAULT_ROOM_ID)
      room.currentTurn = "bob"
      room.turnQueue = ["bob", "alice"]

      await request(app).delete("/api/agents/bob")

      expect(room.currentTurn).toBeNull()
      expect(room.turnQueue).not.toContain("bob")
    })
  })

  describe("POST /api/agents/:id/message", () => {
    it("should stream a response from the agent", async () => {
      const res = await request(app)
        .post("/api/agents/bob/message")
        .send({ text: "Hello Bob!", from: "tester" })

      expect(res.status).toBe(200)
      expect(res.headers["content-type"]).toContain("text/event-stream")
      expect(res.text).toContain("data:")
      expect(res.text).toContain("Hello ")
    })

    it("should return 404 for unknown agent", async () => {
      const res = await request(app)
        .post("/api/agents/unknown/message")
        .send({ text: "Hi", from: "tester" })

      expect(res.status).toBe(404)
    })
  })

  describe("GET /api/agents/:id/history", () => {
    it("should return message history for agent", async () => {
      // Add messages to the default room
      const room = roomManager.getRoom(ctx.DEFAULT_ROOM_ID)
      room.messages = [
        { id: "1", agentId: "bob", name: "Bob", text: "Hello", timestamp: Date.now() },
        { id: "2", agentId: -1, name: "User", text: "Hi", timestamp: Date.now() },
        { id: "3", agentId: "alice", name: "Alice", text: "Hey", timestamp: Date.now() }
      ]

      const res = await request(app).get("/api/agents/bob/history")
      expect(res.status).toBe(200)
      // Should include bob's messages and user messages (agentId -1)
      expect(res.body.data).toHaveLength(2)
    })

    it("should return 404 for unknown agent", async () => {
      const res = await request(app).get("/api/agents/unknown/history")
      expect(res.status).toBe(404)
    })
  })
})
