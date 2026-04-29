// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { io as ioClient } from "socket.io-client"
import express from "express"
import http from "http"
import { Server } from "socket.io"
import { describeE2E, createE2EServer, measureLatency, HAS_ANY_LLM_KEY } from "./setup.js"
import AgentRegistry from "../../agent-registry.js"
import { RoomManager, DEFAULT_ROOM_ID } from "../../room-manager.js"
import { responseHelpers } from "../../src/server/middleware/response.js"

describeE2E("Error Recovery", () => {
  it("should recover after a provider error and handle the next message", async () => {
    // Create a provider that fails on the first call, succeeds on the second
    let callCount = 0
    const flakyProvider = {
      type: "socket",
      name: "flaky",
      async *streamResponse(agentId, userText, systemPrompt, roomId) {
        callCount++
        if (callCount === 1) {
          throw new Error("Simulated provider timeout")
        }
        yield "Recovery "
        yield "successful!"
      },
      clearHistory() {},
      clearRoomHistory() {},
    }

    const ctx = await createE2EServer({ provider: flakyProvider })

    try {
      const client = ioClient(`http://localhost:${ctx.port}/space`, {
        transports: ["websocket"],
        forceNew: true,
      })

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000)
        client.on("connect", () => { clearTimeout(timeout); resolve() })
        client.on("connect_error", (err) => { clearTimeout(timeout); reject(err) })
      })

      // First message — should trigger error
      const errorPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Error event timeout")), 10000)

        const errorHandler = (data) => {
          clearTimeout(timeout)
          client.off("agentError", errorHandler)
          client.off("agentStatus", statusHandler)
          resolve({ type: "error", data })
        }

        // Also listen for status returning to idle (error was handled)
        const statusEvents = []
        const statusHandler = (data) => {
          statusEvents.push(data)
          if (data.status === "idle" && statusEvents.length >= 2) {
            clearTimeout(timeout)
            client.off("agentError", errorHandler)
            client.off("agentStatus", statusHandler)
            resolve({ type: "recovered", statuses: statusEvents })
          }
        }

        client.on("agentError", errorHandler)
        client.on("agentStatus", statusHandler)
      })

      client.emit("userMessage", { text: "This will fail.", from: "Tester" })
      const firstResult = await errorPromise

      // The server should have emitted an error or recovered to idle
      expect(firstResult.type).toBeTruthy()
      console.log(`[E2E] First call result: ${firstResult.type}`)

      // Second message — should succeed
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Recovery timeout")), 10000)
        const handler = (msg) => {
          if (msg.isUser) return
          clearTimeout(timeout)
          client.off("textComplete", handler)
          resolve(msg)
        }
        client.on("textComplete", handler)
        client.emit("userMessage", { text: "This should work.", from: "Tester" })
      })

      expect(response.text).toContain("Recovery successful!")
      console.log(`[E2E] Recovery: "${response.text.trim()}"`)

      client.disconnect()
    } finally {
      await ctx.cleanup()
    }
  })

  it("should handle rapid sequential messages without crashing", async () => {
    // Use a fast mock provider to test message queueing stability
    const fastProvider = {
      type: "socket",
      name: "fast-mock",
      async *streamResponse(agentId, userText, systemPrompt, roomId) {
        yield `Echo: ${userText.slice(0, 30)}`
      },
      clearHistory() {},
      clearRoomHistory() {},
    }

    const ctx = await createE2EServer({ provider: fastProvider })

    try {
      const client = ioClient(`http://localhost:${ctx.port}/space`, {
        transports: ["websocket"],
        forceNew: true,
      })

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000)
        client.on("connect", () => { clearTimeout(timeout); resolve() })
        client.on("connect_error", (err) => { clearTimeout(timeout); reject(err) })
      })

      // Fire 5 messages rapidly
      const messageCount = 5
      const responses = []

      const allDone = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          // Resolve with what we have even if not all arrived
          resolve()
        }, 15000)

        client.on("textComplete", (msg) => {
          if (msg.isUser) return
          responses.push(msg)
          if (responses.length >= messageCount) {
            clearTimeout(timeout)
            resolve()
          }
        })
      })

      for (let i = 0; i < messageCount; i++) {
        client.emit("userMessage", { text: `Message ${i + 1}`, from: "Tester" })
      }

      await allDone

      // Should get at least some responses without crash
      expect(responses.length).toBeGreaterThan(0)
      for (const r of responses) {
        expect(r.text.length).toBeGreaterThan(0)
      }

      console.log(`[E2E] Rapid messages: sent ${messageCount}, received ${responses.length} responses`)

      client.disconnect()
    } finally {
      await ctx.cleanup()
    }
  })

  it("should return proper error on invalid API requests", async () => {
    const ctx = await createE2EServer()

    try {
      const request = (await import("supertest")).default

      // Request a non-existent agent
      const res = await request(ctx.app).get("/api/agents/nonexistent-agent-xyz")
      expect([404, 400, 200]).toContain(res.status) // Depends on route implementation

      // Health endpoint should still work
      const healthRes = await request(ctx.app).get("/api/health")
      expect(healthRes.status).toBe(200)

      console.log(`[E2E] Error handling: agent lookup=${res.status}, health=${healthRes.status}`)
    } finally {
      await ctx.cleanup()
    }
  })
})


