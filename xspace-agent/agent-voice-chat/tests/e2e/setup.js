// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { describe, it, beforeAll, afterAll, expect } from "vitest"
import express from "express"
import http from "http"
import { Server } from "socket.io"
import AgentRegistry from "../../agent-registry.js"
import { RoomManager, DEFAULT_ROOM_ID } from "../../room-manager.js"
import { responseHelpers } from "../../src/server/middleware/response.js"
import createAgentRoutes from "../../src/server/routes/agents.js"
import createSystemRoutes from "../../src/server/routes/system.js"

// ── Provider availability checks ─────────────────────────────

export const HAS_OPENAI_KEY = !!process.env.OPENAI_API_KEY
export const HAS_ANTHROPIC_KEY = !!process.env.ANTHROPIC_API_KEY
export const HAS_GROQ_KEY = !!process.env.GROQ_API_KEY
export const HAS_ELEVENLABS_KEY = !!process.env.ELEVENLABS_API_KEY
export const HAS_ANY_LLM_KEY = HAS_OPENAI_KEY || HAS_ANTHROPIC_KEY || HAS_GROQ_KEY

// ── Conditional describe helpers ─────────────────────────────

/**
 * Wraps describe to skip when no LLM API keys are present.
 */
export function describeE2E(name, fn) {
  if (!HAS_ANY_LLM_KEY) {
    describe.skip(`[E2E] ${name}`, fn)
  } else {
    describe(`[E2E] ${name}`, fn)
  }
}

/**
 * Wraps describe to skip when a specific provider key is missing.
 */
export function describeProvider(provider, fn) {
  const keyMap = {
    "openai-chat": HAS_OPENAI_KEY,
    openai: HAS_OPENAI_KEY,
    claude: HAS_ANTHROPIC_KEY,
    groq: HAS_GROQ_KEY,
    elevenlabs: HAS_ELEVENLABS_KEY,
    "openai-tts": HAS_OPENAI_KEY,
    "openai-stt": HAS_OPENAI_KEY,
    "groq-stt": HAS_GROQ_KEY,
  }

  const hasKey = keyMap[provider]
  if (!hasKey) {
    describe.skip(`[E2E] Provider: ${provider}`, fn)
  } else {
    describe(`[E2E] Provider: ${provider}`, fn)
  }
}

// ── Latency measurement ──────────────────────────────────────

/**
 * Measures async operation latency in milliseconds.
 * Returns { result, latencyMs }.
 */
export async function measureLatency(fn) {
  const start = performance.now()
  const result = await fn()
  const latencyMs = Math.round(performance.now() - start)
  return { result, latencyMs }
}

// ── E2E Server bootstrap ────────────────────────────────────

/**
 * Creates a real server with a real LLM provider for E2E testing.
 * Falls back through providers: openai-chat → claude → groq.
 *
 * @param {object} opts
 * @param {object} [opts.provider] - Override the LLM provider
 * @param {object} [opts.tts] - Override the TTS provider
 * @param {string} [opts.apiKey] - API key for auth (null = no auth)
 * @returns {Promise<object>} { app, server, io, spaceNS, port, registry, roomManager, provider, cleanup }
 */
export async function createE2EServer(opts = {}) {
  const {
    apiKey = null,
    provider: providerOverride,
    tts: ttsOverride,
  } = opts

  // Resolve LLM provider (real)
  let provider = providerOverride
  if (!provider) {
    provider = createRealProvider()
  }

  // TTS — default to mock for speed unless overridden
  const tts = ttsOverride || {
    TTS_PROVIDER: "browser",
    TTS_FORMAT: "mp3",
    voiceMap: {},
    async synthesize() { return null }
  }

  const app = express()
  const server = http.createServer(app)
  const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 5000,
    pingInterval: 3000,
  })
  const spaceNS = io.of("/space")

  const registry = new AgentRegistry()
  const defaultAgents = {}
  for (const agent of registry.getAllAgents()) {
    defaultAgents[agent.id] = { id: agent.id, name: agent.name }
  }

  const roomManager = new RoomManager({ defaultAgents })
  roomManager.createRoom({ id: DEFAULT_ROOM_ID })

  app.use(express.json())

  // Optional auth
  function authMiddleware(req, res, next) {
    if (!apiKey) return next()
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing auth" } })
    }
    if (authHeader.slice(7) !== apiKey) {
      return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid key" } })
    }
    next()
  }

  app.use("/api", responseHelpers)
  app.use("/api", authMiddleware)
  app.use("/api/agents", createAgentRoutes({ registry, roomManager, DEFAULT_ROOM_ID, provider, spaceNS }))
  app.use("/api", createSystemRoutes({ provider, AI_PROVIDER: provider.name || "unknown", tts, registry, spaceState: {}, metrics: null }))

  // Socket.IO with real LLM handler
  spaceNS.on("connection", (socket) => {
    const room = roomManager.getRoom(DEFAULT_ROOM_ID)
    if (!room) return

    socket.join(DEFAULT_ROOM_ID)
    roomManager.addClient(DEFAULT_ROOM_ID, socket.id)

    socket.emit("stateUpdate", { agents: room.agents, currentTurn: room.currentTurn, turnQueue: room.turnQueue })
    socket.emit("messageHistory", room.messages.slice(-50))

    socket.on("agentConnect", ({ agentId }) => {
      if (room.agents[agentId]) {
        room.agents[agentId].connected = true
        room.agents[agentId].status = "idle"
        room.agents[agentId].socketId = socket.id
        broadcastState(room)
      }
    })

    socket.on("userMessage", ({ text, from, targetAgentId }) => {
      const msg = {
        id: Date.now().toString(),
        agentId: -1,
        name: from || "User",
        text,
        timestamp: Date.now(),
        isUser: true,
      }
      room.messages.push(msg)
      spaceNS.to(room.id).emit("userMessage", msg)
      spaceNS.to(room.id).emit("textComplete", msg)

      // Route to a specific agent or first available
      const agentId = targetAgentId || registry.getAllAgents()[0]?.id || "bob"
      handleLLMResponse(socket, room, agentId, `[CHAT - ${from || "User"}]: ${text}`)
    })

    socket.on("disconnect", () => {
      roomManager.removeClient(DEFAULT_ROOM_ID, socket.id)
    })
  })

  function broadcastState(room) {
    spaceNS.to(room.id).emit("stateUpdate", { agents: room.agents, currentTurn: room.currentTurn, turnQueue: room.turnQueue })
  }

  async function handleLLMResponse(socket, room, agentId, userText) {
    const messageId = Date.now().toString()
    const agent = registry.getAgent(agentId)
    const agentName = agent?.name || "Agent"

    if (room.agents[agentId]) room.agents[agentId].status = "speaking"
    spaceNS.to(room.id).emit("agentStatus", { agentId, status: "speaking", name: agentName })

    let fullText = ""
    try {
      const systemPrompt = registry.getSystemPrompt(agentId) || "You are a helpful assistant. Keep responses brief (1-2 sentences)."
      for await (const delta of provider.streamResponse(agentId, userText, systemPrompt, DEFAULT_ROOM_ID)) {
        fullText += delta
        spaceNS.to(room.id).emit("textDelta", { agentId, delta, messageId, name: agentName })
      }
      const msg = { id: messageId, agentId, name: agentName, text: fullText, timestamp: Date.now() }
      room.messages.push(msg)
      spaceNS.to(room.id).emit("textComplete", msg)
    } catch (err) {
      spaceNS.to(room.id).emit("agentError", { agentId, error: err.message })
    } finally {
      if (room.agents[agentId]) room.agents[agentId].status = "idle"
      spaceNS.to(room.id).emit("agentStatus", { agentId, status: "idle", name: agentName })
    }
  }

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
    provider,
    cleanup: () => new Promise((resolve) => {
      roomManager.destroy()
      io.close(() => server.close(() => resolve()))
    }),
  }
}

// ── Real provider factory ────────────────────────────────────

/**
 * Creates a real LLM provider based on available API keys.
 * Priority: openai-chat → claude → groq
 */
function createRealProvider() {
  if (HAS_OPENAI_KEY) {
    const OpenAIChatProvider = require("../../providers/openai-chat.js")
    return new OpenAIChatProvider()
  }
  if (HAS_ANTHROPIC_KEY) {
    const ClaudeProvider = require("../../providers/claude.js")
    return new ClaudeProvider()
  }
  if (HAS_GROQ_KEY) {
    const GroqProvider = require("../../providers/groq.js")
    return new GroqProvider()
  }
  throw new Error("No LLM API keys available for E2E tests")
}

/**
 * Creates a specific real LLM provider by name.
 * Throws if the required API key is not set.
 */
export function createProviderByName(name) {
  switch (name) {
    case "openai-chat": {
      if (!HAS_OPENAI_KEY) throw new Error("OPENAI_API_KEY not set")
      const OpenAIChatProvider = require("../../providers/openai-chat.js")
      return new OpenAIChatProvider()
    }
    case "claude": {
      if (!HAS_ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set")
      const ClaudeProvider = require("../../providers/claude.js")
      return new ClaudeProvider()
    }
    case "groq": {
      if (!HAS_GROQ_KEY) throw new Error("GROQ_API_KEY not set")
      const GroqProvider = require("../../providers/groq.js")
      return new GroqProvider()
    }
    default:
      throw new Error(`Unknown provider: ${name}`)
  }
}


