// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { io as ioClient } from "socket.io-client"
import { describeE2E, createE2EServer, measureLatency } from "./setup.js"

describeE2E("Full Message Flow", () => {
  let ctx
  let port

  beforeAll(async () => {
    ctx = await createE2EServer()
    port = ctx.port
  })

  afterAll(async () => {
    await ctx?.cleanup()
  })

  it("should process a text message through the real LLM and emit response events", async () => {
    const client = ioClient(`http://localhost:${port}/space`, {
      transports: ["websocket"],
      forceNew: true,
    })

    try {
      // Wait for connection and initial events
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000)
        client.on("connect", () => { clearTimeout(timeout); resolve() })
        client.on("connect_error", (err) => { clearTimeout(timeout); reject(err) })
      })

      // Collect textDelta events and wait for textComplete
      const deltas = []
      let completeMsg = null

      const responsePromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("LLM response timeout")), 30000)

        client.on("textDelta", ({ delta }) => {
          deltas.push(delta)
        })

        client.on("textComplete", (msg) => {
          if (msg.isUser) return // skip the echo of user message
          clearTimeout(timeout)
          completeMsg = msg
          resolve()
        })
      })

      // Connect an agent first
      const agents = ctx.registry.getAllAgents()
      if (agents.length > 0) {
        client.emit("agentConnect", { agentId: agents[0].id })
      }

      // Send user message
      const { latencyMs } = await measureLatency(async () => {
        client.emit("userMessage", { text: "What is 2+2? Answer with just the number.", from: "E2E Tester" })
        await responsePromise
      })

      expect(completeMsg).toBeTruthy()
      expect(completeMsg.text).toBeTruthy()
      expect(completeMsg.text.length).toBeGreaterThan(0)
      expect(completeMsg.agentId).toBeTruthy()
      expect(completeMsg.name).toBeTruthy()
      expect(deltas.length).toBeGreaterThan(0)
      expect(latencyMs).toBeLessThan(30000)

      console.log(`[E2E] Full flow: "${completeMsg.text.trim()}" from ${completeMsg.name} (${latencyMs}ms, ${deltas.length} deltas)`)
    } finally {
      client.disconnect()
    }
  })

  it("should emit agentStatus events during processing", async () => {
    const client = ioClient(`http://localhost:${port}/space`, {
      transports: ["websocket"],
      forceNew: true,
    })

    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000)
        client.on("connect", () => { clearTimeout(timeout); resolve() })
        client.on("connect_error", (err) => { clearTimeout(timeout); reject(err) })
      })

      const statuses = []

      const donePromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Status events timeout")), 30000)

        client.on("agentStatus", (data) => {
          statuses.push(data)
          // Wait for idle status (processing complete)
          if (data.status === "idle" && statuses.length >= 2) {
            clearTimeout(timeout)
            resolve()
          }
        })
      })

      client.emit("userMessage", { text: "Say hi.", from: "Tester" })
      await donePromise

      // Should have at least speaking → idle
      const speakingStatus = statuses.find(s => s.status === "speaking")
      const idleStatus = statuses.find(s => s.status === "idle")
      expect(speakingStatus).toBeTruthy()
      expect(idleStatus).toBeTruthy()

      console.log(`[E2E] Agent statuses: ${statuses.map(s => s.status).join(" → ")}`)
    } finally {
      client.disconnect()
    }
  })

  it("should handle multiple sequential messages", async () => {
    const client = ioClient(`http://localhost:${port}/space`, {
      transports: ["websocket"],
      forceNew: true,
    })

    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000)
        client.on("connect", () => { clearTimeout(timeout); resolve() })
        client.on("connect_error", (err) => { clearTimeout(timeout); reject(err) })
      })

      const messages = ["Say 'one'.", "Say 'two'."]
      const responses = []

      for (const msg of messages) {
        const response = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Response timeout")), 30000)

          const handler = (data) => {
            if (data.isUser) return
            clearTimeout(timeout)
            client.off("textComplete", handler)
            resolve(data)
          }
          client.on("textComplete", handler)
          client.emit("userMessage", { text: msg, from: "Tester" })
        })
        responses.push(response)
      }

      expect(responses).toHaveLength(2)
      for (const r of responses) {
        expect(r.text.length).toBeGreaterThan(0)
      }

      console.log(`[E2E] Sequential messages: ${responses.map(r => `"${r.text.trim()}"`).join(", ")}`)
    } finally {
      client.disconnect()
    }
  })
})


