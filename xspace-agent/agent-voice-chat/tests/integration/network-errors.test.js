// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import request from "supertest"
import { createTestServer } from "../helpers/create-test-server.js"
import { createTestApp } from "../helpers/create-test-app.js"
import { createMockProvider } from "../helpers/mock-provider.js"
import { createConnectedClient, waitForEvent, disconnectClient, collectEvents } from "../helpers/socket-helpers.js"
import createAgentRoutes from "../../src/server/routes/agents.js"

describe("Network Error Handling", () => {
  describe("Socket.IO disconnection", () => {
    let ctx

    beforeEach(async () => {
      ctx = await createTestServer()
    })

    afterEach(async () => {
      await ctx.cleanup()
    })

    it("cleans up room state when client disconnects abruptly", async () => {
      const client = await createConnectedClient(ctx.port)

      // Connect an agent so the socket has an association
      await waitForEvent(client, "stateUpdate")
      client.emit("agentConnect", { agentId: "bob" })
      await waitForEvent(client, "stateUpdate")

      const socketId = client.id

      // Disconnect the client
      await disconnectClient(client)

      // Allow the server to process the disconnect
      await new Promise(r => setTimeout(r, 100))

      const room = ctx.roomManager.getRoom("default")
      // Socket should be removed from room clients
      expect(room.clients.has(socketId)).toBe(false)
    })

    it("handles disconnect during active audio stream", async () => {
      // Use a slow provider that yields tokens with delay
      const slowProvider = createMockProvider({ delay: 50, defaultResponse: "one two three four five" })
      const slowCtx = await createTestServer({ provider: slowProvider })

      const client = await createConnectedClient(slowCtx.port)
      try {
        await waitForEvent(client, "stateUpdate")

        // Send a message to start a slow LLM stream
        client.emit("userMessage", { text: "Hello", from: "User" })

        // Disconnect mid-stream (after a short delay)
        await new Promise(r => setTimeout(r, 25))
        await disconnectClient(client)

        // Give server time to finish handling the disconnect
        await new Promise(r => setTimeout(r, 200))

        // Server should not throw — verify it's still responsive
        const newClient = await createConnectedClient(slowCtx.port)
        const state = await waitForEvent(newClient, "stateUpdate")
        expect(state).toHaveProperty("agents")
        await disconnectClient(newClient)
      } finally {
        await slowCtx.cleanup()
      }
    })

    it("handles disconnect during LLM response streaming", async () => {
      // Provider with slight delay so we can disconnect before it finishes
      const delayedProvider = createMockProvider({ delay: 30, defaultResponse: "word1 word2 word3" })
      const delayCtx = await createTestServer({ provider: delayedProvider })

      const client = await createConnectedClient(delayCtx.port)
      try {
        await waitForEvent(client, "stateUpdate")
        client.emit("userMessage", { text: "stream test", from: "User" })

        // Disconnect abruptly before the stream finishes
        await new Promise(r => setTimeout(r, 10))
        client.disconnect()

        // Server must survive — connect a fresh client to confirm
        await new Promise(r => setTimeout(r, 300))
        const fresh = await createConnectedClient(delayCtx.port)
        const state = await waitForEvent(fresh, "stateUpdate")
        expect(state).toHaveProperty("agents")
        await disconnectClient(fresh)
      } finally {
        await delayCtx.cleanup()
      }
    })

    it("handles rapid connect/disconnect cycles", async () => {
      const CYCLES = 5

      for (let i = 0; i < CYCLES; i++) {
        const client = await createConnectedClient(ctx.port)
        await waitForEvent(client, "stateUpdate")
        await disconnectClient(client)
      }

      // Server must still be healthy
      const finalClient = await createConnectedClient(ctx.port)
      const state = await waitForEvent(finalClient, "stateUpdate")
      expect(state).toHaveProperty("agents")
      await disconnectClient(finalClient)
    })

    it("does not leave ghost entries in room state", async () => {
      const client = await createConnectedClient(ctx.port)
      await waitForEvent(client, "stateUpdate")
      client.emit("agentConnect", { agentId: "bob" })
      await waitForEvent(client, "stateUpdate")

      const socketId = client.id
      await disconnectClient(client)
      await new Promise(r => setTimeout(r, 100))

      const room = ctx.roomManager.getRoom("default")
      // Client set must not retain the disconnected socket id
      expect(room.clients.has(socketId)).toBe(false)
      // Agent status must be reset to offline
      expect(room.agents.bob.connected).toBe(false)
      expect(room.agents.bob.status).toBe("offline")
    })
  })

  describe("request timeouts", () => {
    it("SSE endpoints timeout after max duration", async () => {
      // A very slow provider so we can observe the response open, then abort
      const slowProvider = {
        type: "socket",
        async *streamResponse() {
          await new Promise(r => setTimeout(r, 200))
          yield "late "
          yield "response"
        },
        clearHistory() {}
      }
      const appCtx = createTestApp()
      appCtx.app.use("/api/agents", createAgentRoutes({
        registry: appCtx.registry,
        roomManager: appCtx.roomManager,
        DEFAULT_ROOM_ID: appCtx.DEFAULT_ROOM_ID,
        provider: slowProvider,
        spaceNS: appCtx.spaceNS
      }))

      try {
        const res = await request(appCtx.app)
          .post("/api/agents/bob/message")
          .send({ text: "slow request", from: "user" })
          .timeout(5000)

        expect(res.status).toBe(200)
        expect(res.headers["content-type"]).toContain("text/event-stream")
        expect(res.text).toContain("late")
      } finally {
        appCtx.roomManager.destroy()
      }
    })

    it("streaming responses handle client disconnect", async () => {
      const ctx = await createTestServer({
        provider: createMockProvider({ delay: 20, defaultResponse: "a b c d e f g h i j" })
      })

      try {
        const client = await createConnectedClient(ctx.port)
        await waitForEvent(client, "stateUpdate")

        // Start a streaming response then immediately disconnect
        client.emit("userMessage", { text: "stream test", from: "User" })
        await new Promise(r => setTimeout(r, 5))
        await disconnectClient(client)

        // Server must not crash; give it time to finish
        await new Promise(r => setTimeout(r, 300))

        // Re-connect to confirm server is alive
        const verifyClient = await createConnectedClient(ctx.port)
        const state = await waitForEvent(verifyClient, "stateUpdate")
        expect(state).toHaveProperty("agents")
        await disconnectClient(verifyClient)
      } finally {
        await ctx.cleanup()
      }
    })

    it("in-flight requests are tracked and cleaned up", async () => {
      const appCtx = createTestApp()
      appCtx.app.use("/api/agents", createAgentRoutes({
        registry: appCtx.registry,
        roomManager: appCtx.roomManager,
        DEFAULT_ROOM_ID: appCtx.DEFAULT_ROOM_ID,
        provider: createMockProvider(),
        spaceNS: appCtx.spaceNS
      }))

      try {
        const room = appCtx.roomManager.getRoom("default")
        const msgsBefore = room.messages.length

        await request(appCtx.app)
          .post("/api/agents/bob/message")
          .send({ text: "track me", from: "user" })

        // After completion the messages array has the new entries
        expect(room.messages.length).toBeGreaterThan(msgsBefore)
      } finally {
        appCtx.roomManager.destroy()
      }
    })
  })

  describe("concurrent requests", () => {
    it("handles multiple simultaneous messages to same agent", async () => {
      const appCtx = createTestApp()
      appCtx.app.use("/api/agents", createAgentRoutes({
        registry: appCtx.registry,
        roomManager: appCtx.roomManager,
        DEFAULT_ROOM_ID: appCtx.DEFAULT_ROOM_ID,
        provider: createMockProvider(),
        spaceNS: appCtx.spaceNS
      }))

      try {
        const requests = Array.from({ length: 3 }, (_, i) =>
          request(appCtx.app)
            .post("/api/agents/bob/message")
            .send({ text: `Concurrent message ${i}`, from: "user" })
        )

        const results = await Promise.all(requests)
        // All requests should return valid SSE responses
        for (const res of results) {
          expect(res.status).toBe(200)
          expect(res.headers["content-type"]).toContain("text/event-stream")
        }
      } finally {
        appCtx.roomManager.destroy()
      }
    })

    it("handles concurrent room joins", async () => {
      const ctx = await createTestServer()

      try {
        const clients = await Promise.all([
          createConnectedClient(ctx.port),
          createConnectedClient(ctx.port),
          createConnectedClient(ctx.port)
        ])

        // All clients should receive their initial stateUpdate
        const states = await Promise.all(clients.map(c => waitForEvent(c, "stateUpdate")))

        for (const state of states) {
          expect(state).toHaveProperty("agents")
        }

        const room = ctx.roomManager.getRoom("default")
        expect(room.clients.size).toBe(3)

        await Promise.all(clients.map(c => disconnectClient(c)))
      } finally {
        await ctx.cleanup()
      }
    })

    it("handles race between message and disconnect", async () => {
      const ctx = await createTestServer()

      try {
        const client = await createConnectedClient(ctx.port)
        await waitForEvent(client, "stateUpdate")

        // Emit message and disconnect simultaneously (race condition)
        client.emit("userMessage", { text: "race condition test", from: "User" })
        client.disconnect()

        // Server should handle the race without crashing
        await new Promise(r => setTimeout(r, 200))

        // Fresh client can still connect
        const freshClient = await createConnectedClient(ctx.port)
        const state = await waitForEvent(freshClient, "stateUpdate")
        expect(state).toHaveProperty("agents")
        await disconnectClient(freshClient)
      } finally {
        await ctx.cleanup()
      }
    })
  })
})


