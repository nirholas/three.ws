// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { io as ioClient } from "socket.io-client"
import { describeE2E, createE2EServer, measureLatency } from "./setup.js"

describeE2E("Multi-Agent Conversation", () => {
  let ctx
  let port

  beforeAll(async () => {
    ctx = await createE2EServer()
    port = ctx.port
  })

  afterAll(async () => {
    await ctx?.cleanup()
  })

  it("should route a message to a specific agent by targetAgentId", async () => {
    const agents = ctx.registry.getAllAgents()
    expect(agents.length).toBeGreaterThanOrEqual(2)

    const targetAgent = agents[1] // Use second agent (alice)
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

      // Connect both agents
      for (const agent of agents) {
        client.emit("agentConnect", { agentId: agent.id })
      }

      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Response timeout")), 30000)
        const handler = (msg) => {
          if (msg.isUser) return
          clearTimeout(timeout)
          client.off("textComplete", handler)
          resolve(msg)
        }
        client.on("textComplete", handler)
        client.emit("userMessage", {
          text: "Say hello.",
          from: "Tester",
          targetAgentId: targetAgent.id,
        })
      })

      expect(response.agentId).toBe(targetAgent.id)
      expect(response.name).toBe(targetAgent.name)
      expect(response.text.length).toBeGreaterThan(0)

      console.log(`[E2E] Routed to ${targetAgent.name}: "${response.text.trim()}"`)
    } finally {
      client.disconnect()
    }
  })

  it("should default to first agent when no target specified", async () => {
    const agents = ctx.registry.getAllAgents()
    const defaultAgent = agents[0]

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

      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Response timeout")), 30000)
        const handler = (msg) => {
          if (msg.isUser) return
          clearTimeout(timeout)
          client.off("textComplete", handler)
          resolve(msg)
        }
        client.on("textComplete", handler)
        client.emit("userMessage", { text: "Say hi.", from: "Tester" })
      })

      expect(response.agentId).toBe(defaultAgent.id)
      expect(response.text.length).toBeGreaterThan(0)

      console.log(`[E2E] Default agent: ${response.name} responded: "${response.text.trim()}"`)
    } finally {
      client.disconnect()
    }
  })

  it("should list all registered agents via API", async () => {
    const request = (await import("supertest")).default
    const res = await request(ctx.app).get("/api/agents")

    expect(res.status).toBe(200)
    expect(res.body.data).toBeDefined()
    expect(res.body.data.length).toBeGreaterThanOrEqual(2)

    const names = res.body.data.map(a => a.name)
    console.log(`[E2E] Registered agents: ${names.join(", ")}`)
  })
})


