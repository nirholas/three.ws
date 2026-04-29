// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import request from "supertest"
import createRoomRoutes from "../../src/server/routes/rooms.js"
import { createTestApp } from "../helpers/create-test-app.js"

describe("Room API routes", () => {
  let app, roomManager, ctx

  beforeEach(() => {
    ctx = createTestApp()
    app = ctx.app
    roomManager = ctx.roomManager

    const roomRouter = createRoomRoutes({
      registry: ctx.registry,
      roomManager: ctx.roomManager,
      DEFAULT_ROOM_ID: ctx.DEFAULT_ROOM_ID,
      provider: ctx.provider,
      spaceNS: ctx.spaceNS
    })
    app.use("/api/rooms", roomRouter)
  })

  afterEach(() => {
    roomManager.destroy()
  })

  describe("GET /api/rooms", () => {
    it("should return room list including default room", async () => {
      const res = await request(app).get("/api/rooms")
      expect(res.status).toBe(200)
      expect(res.body.data.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("POST /api/rooms", () => {
    it("should create a new room", async () => {
      const res = await request(app)
        .post("/api/rooms")
        .send({ agentIds: ["bob", "alice"] })

      expect(res.status).toBe(201)
      expect(res.body.data.id).toBeDefined()
    })

    it("should validate missing agent ids", async () => {
      const res = await request(app)
        .post("/api/rooms")
        .send({ agentIds: ["bob", "nonexistent"] })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe("VALIDATION_ERROR")
    })
  })

  describe("GET /api/rooms/:id", () => {
    it("should return room details", async () => {
      const create = await request(app)
        .post("/api/rooms")
        .send({ agentIds: ["bob"] })
      const roomId = create.body.data.id

      const res = await request(app).get(`/api/rooms/${roomId}`)
      expect(res.status).toBe(200)
      expect(res.body.data.id).toBe(roomId)
    })

    it("should return 404 for unknown room", async () => {
      const res = await request(app).get("/api/rooms/nonexistent-room")
      expect(res.status).toBe(404)
    })
  })

  describe("GET /api/rooms/:id/messages", () => {
    it("should return room messages", async () => {
      const create = await request(app)
        .post("/api/rooms")
        .send({ agentIds: ["bob"] })
      const roomId = create.body.data.id

      const res = await request(app).get(`/api/rooms/${roomId}/messages`)
      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
    })

    it("should return 404 for unknown room", async () => {
      const res = await request(app).get("/api/rooms/nonexistent-room/messages")
      expect(res.status).toBe(404)
    })
  })

  describe("POST /api/rooms/:id/message", () => {
    it("should send a message and get agent response", async () => {
      const create = await request(app)
        .post("/api/rooms")
        .send({ agentIds: ["bob"] })
      const roomId = create.body.data.id

      const res = await request(app)
        .post(`/api/rooms/${roomId}/message`)
        .send({ text: "Hello!", from: "tester" })

      expect(res.status).toBe(200)
      expect(res.body.data.message.text).toBe("Hello World")
      expect(res.body.data.message.agentId).toBe("bob")
    })

    it("should allow targeting a specific agent", async () => {
      const create = await request(app)
        .post("/api/rooms")
        .send({ agentIds: ["bob", "alice"] })
      const roomId = create.body.data.id

      const res = await request(app)
        .post(`/api/rooms/${roomId}/message`)
        .send({ text: "Hi Alice!", targetAgentId: "alice" })

      expect(res.status).toBe(200)
      expect(res.body.data.message.agentId).toBe("alice")
    })

    it("should reject targeting agent not in room", async () => {
      const create = await request(app)
        .post("/api/rooms")
        .send({ agentIds: ["bob"] })
      const roomId = create.body.data.id

      const res = await request(app)
        .post(`/api/rooms/${roomId}/message`)
        .send({ text: "Hi Alice!", targetAgentId: "alice" })

      expect(res.status).toBe(400)
    })

    it("should return 404 for unknown room", async () => {
      const res = await request(app)
        .post("/api/rooms/nonexistent-room/message")
        .send({ text: "Hello" })

      expect(res.status).toBe(404)
    })
  })

  describe("DELETE /api/rooms/:id", () => {
    it("should delete a room", async () => {
      const create = await request(app)
        .post("/api/rooms")
        .send({ agentIds: ["bob"] })
      const roomId = create.body.data.id

      const res = await request(app).delete(`/api/rooms/${roomId}`)
      expect(res.status).toBe(200)
      expect(res.body.data.deleted).toBe(true)
    })

    it("should return 404 for unknown room", async () => {
      const res = await request(app).delete("/api/rooms/nonexistent-room")
      expect(res.status).toBe(404)
    })

    it("should not allow deleting the default room", async () => {
      const res = await request(app).delete(`/api/rooms/${ctx.DEFAULT_ROOM_ID}`)
      expect(res.status).toBe(403)
    })
  })
})


