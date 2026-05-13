// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import express from "express"
import http from "http"
import { Server } from "socket.io"
import AgentRegistry from "../../agent-registry.js"
import { RoomManager, DEFAULT_ROOM_ID } from "../../room-manager.js"
import { responseHelpers } from "../../src/server/middleware/response.js"
import createAgentRoutes from "../../src/server/routes/agents.js"
import createSystemRoutes from "../../src/server/routes/system.js"
import { createMockProvider } from "./mock-provider.js"
import { createMockTTS } from "./mock-tts-stt.js"

/**
 * Creates a fully-functional test server with mock dependencies.
 * Uses the real route modules and middleware.
 *
 * @param {object} opts
 * @param {string} opts.apiKey - API key for auth (null = no auth)
 * @param {object} opts.provider - Mock LLM provider
 * @param {object} opts.tts - Mock TTS provider
 * @returns {Promise<object>} { app, server, io, spaceNS, port, registry, roomManager, cleanup }
 */
export async function createTestServer(opts = {}) {
  const {
    apiKey = null,
    provider = createMockProvider(),
    tts = createMockTTS()
  } = opts

  const app = express()
  const server = http.createServer(app)
  const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 5000,
    pingInterval: 3000
  })
  const spaceNS = io.of("/space")

  const registry = new AgentRegistry()

  // Build default agents map from registry
  const defaultAgents = {}
  for (const agent of registry.getAllAgents()) {
    defaultAgents[agent.id] = { id: agent.id, name: agent.name }
  }

  const roomManager = new RoomManager({ defaultAgents })
  // Create the default room
  roomManager.createRoom({ id: DEFAULT_ROOM_ID })

  app.use(express.json())

  // Auth middleware (custom for testing, mirrors real auth.js pattern)
  function testAuthMiddleware(req, res, next) {
    if (!apiKey) return next()
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Missing or invalid Authorization header" }
      })
    }
    if (authHeader.slice(7) !== apiKey) {
      return res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Invalid API key" }
      })
    }
    next()
  }

  // Middleware for all /api routes
  app.use("/api", responseHelpers)
  app.use("/api", testAuthMiddleware)

  // Mount route modules
  app.use("/api/agents", createAgentRoutes({
    registry,
    roomManager,
    DEFAULT_ROOM_ID,
    provider,
    spaceNS
  }))

  app.use("/api", createSystemRoutes({
    provider,
    AI_PROVIDER: "mock",
    tts,
    registry,
    spaceState: {},
    metrics: null
  }))

  // Socket.IO handlers for core events (simplified from server.js)
  spaceNS.on("connection", (socket) => {
    const room = roomManager.getRoom(DEFAULT_ROOM_ID)
    if (!room) return

    socket.join(DEFAULT_ROOM_ID)
    roomManager.addClient(DEFAULT_ROOM_ID, socket.id)

    socket.emit("stateUpdate", {
      agents: room.agents,
      currentTurn: room.currentTurn,
      turnQueue: room.turnQueue
    })
    socket.emit("messageHistory", room.messages.slice(-50))

    socket.on("agentConnect", ({ agentId }) => {
      if (room.agents[agentId]) {
        room.agents[agentId].connected = true
        room.agents[agentId].status = "idle"
        room.agents[agentId].socketId = socket.id
        broadcastRoomState(room)
      }
    })

    socket.on("agentDisconnect", ({ agentId }) => {
      if (room.agents[agentId]) {
        room.agents[agentId].connected = false
        room.agents[agentId].status = "offline"
        if (room.currentTurn === agentId) releaseTurn(room, agentId)
        room.turnQueue = room.turnQueue.filter(id => id !== agentId)
        broadcastRoomState(room)
      }
    })

    socket.on("requestTurn", ({ agentId }) => {
      const granted = requestTurn(room, agentId)
      socket.emit("turnResponse", { granted, currentTurn: room.currentTurn })
    })

    socket.on("releaseTurn", ({ agentId }) => releaseTurn(room, agentId))

    socket.on("userMessage", ({ text, from }) => {
      const msg = {
        id: Date.now().toString(),
        agentId: -1,
        name: from || "User",
        text,
        timestamp: Date.now(),
        isUser: true
      }
      room.messages.push(msg)
      spaceNS.to(room.id).emit("userMessage", msg)
      spaceNS.to(room.id).emit("textComplete", msg)

      if (provider.type === "socket") {
        handleLLMResponse(socket, room, registry.getAllAgents()[0]?.id || "bob", `[CHAT - ${from || "User"}]: ${text}`)
      }
    })

    socket.on("disconnect", () => {
      roomManager.removeClient(DEFAULT_ROOM_ID, socket.id)
      for (const id in room.agents) {
        if (room.agents[id].socketId === socket.id) {
          room.agents[id].connected = false
          room.agents[id].status = "offline"
          if (room.currentTurn === id) releaseTurn(room, id)
          room.turnQueue = room.turnQueue.filter(aid => aid !== id)
        }
      }
      broadcastRoomState(room)
    })
  })

  function broadcastRoomState(room) {
    spaceNS.to(room.id).emit("stateUpdate", {
      agents: room.agents,
      currentTurn: room.currentTurn,
      turnQueue: room.turnQueue
    })
  }

  function requestTurn(room, agentId) {
    if (room.currentTurn === null && !room.isProcessing) {
      room.currentTurn = agentId
      room.isProcessing = true
      spaceNS.to(room.id).emit("turnGranted", { agentId })
      broadcastRoomState(room)
      return true
    }
    if (!room.turnQueue.includes(agentId) && room.currentTurn !== agentId) {
      room.turnQueue.push(agentId)
      broadcastRoomState(room)
    }
    return false
  }

  function releaseTurn(room, agentId) {
    if (room.currentTurn !== agentId) return
    room.currentTurn = null
    room.isProcessing = false
    if (room.turnQueue.length > 0) {
      const next = room.turnQueue.shift()
      setTimeout(() => {
        room.currentTurn = next
        room.isProcessing = true
        spaceNS.to(room.id).emit("turnGranted", { agentId: next })
        broadcastRoomState(room)
      }, 50) // Shorter delay for tests
    } else {
      broadcastRoomState(room)
    }
  }

  async function handleLLMResponse(socket, room, agentId, userText) {
    requestTurn(room, agentId)
    const messageId = Date.now().toString()
    const agent = registry.getAgent(agentId)
    const agentName = agent?.name || "Agent"

    if (room.agents[agentId]) room.agents[agentId].status = "speaking"
    spaceNS.to(room.id).emit("agentStatus", { agentId, status: "speaking", name: agentName })
    broadcastRoomState(room)

    let fullText = ""
    try {
      const systemPrompt = registry.getSystemPrompt(agentId)
      for await (const delta of provider.streamResponse(agentId, userText, systemPrompt, room.id)) {
        fullText += delta
        spaceNS.to(room.id).emit("textDelta", { agentId, delta, messageId, name: agentName })
      }
      const msg = { id: messageId, agentId, name: agentName, text: fullText, timestamp: Date.now() }
      room.messages.push(msg)
      spaceNS.to(room.id).emit("textComplete", msg)
    } catch (err) {
      // silently handle in tests
    } finally {
      if (room.agents[agentId]) room.agents[agentId].status = "idle"
      spaceNS.to(room.id).emit("agentStatus", { agentId, status: "idle", name: agentName })
      releaseTurn(room, agentId)
    }
  }

  // Start server on random port
  await new Promise((resolve) => server.listen(0, resolve))
  const port = server.address().port

  return {
    app,
    server,
    io,
    spaceNS,
    port,
    registry,
    roomManager,
    cleanup: () => {
      return new Promise((resolve) => {
        roomManager.destroy()
        io.close(() => {
          server.close(() => resolve())
        })
      })
    }
  }
}


