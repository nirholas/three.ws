// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { PROVIDER_TYPES, STREAM_TIMEOUT_MS, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require("../constants")
const { Router } = require("express")
const { z } = require("zod")
const { validate } = require("../middleware/validate")
const { validateRoomId, formatChatForLLM } = require("../middleware/sanitize")

const ThemeSchema = z.object({
  primary: z.string().optional(),
  gradient: z.array(z.string()).optional(),
  background: z.array(z.string()).optional()
}).optional()

const CreateAgentSchema = z.object({
  id: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, "ID must be lowercase alphanumeric with hyphens/underscores"),
  name: z.string().min(1).max(50),
  personality: z.string().max(2000).optional().default(""),
  voice: z.string().optional(),
  avatar: z.string().optional().default(""),
  theme: ThemeSchema
})

const UpdateAgentSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  personality: z.string().max(2000).optional(),
  voice: z.string().optional(),
  avatar: z.string().optional(),
  theme: ThemeSchema
})

const MessageSchema = z.object({
  text: z.string().min(1).max(5000),
  from: z.string().min(1).max(100).optional().default("api-user")
})

/**
 * @param {object} deps
 * @param {import('../../../agent-registry')} deps.registry
 * @param {import('../../../room-manager').RoomManager} deps.roomManager
 * @param {string} deps.DEFAULT_ROOM_ID
 * @param {object} deps.provider - LLM provider
 * @param {object} deps.spaceNS - Socket.IO namespace
 */
module.exports = function createAgentRoutes(deps) {
  const { registry, roomManager, DEFAULT_ROOM_ID, provider, spaceNS } = deps
  const router = Router()

  /** Get agent runtime status from the default room */
  function getAgentStatus(agentId) {
    const room = roomManager.getRoom(DEFAULT_ROOM_ID)
    if (!room || !room.agents[agentId]) return { status: "offline", connected: false }
    return { status: room.agents[agentId].status, connected: room.agents[agentId].connected }
  }

  function broadcastRoomState(room) {
    spaceNS.to(room.id).emit("stateUpdate", {
      agents: room.agents,
      currentTurn: room.currentTurn,
      turnQueue: room.turnQueue
    })
  }

  // ── GET /api/agents ──────────────────────────────────────────
  router.get("/", (req, res) => {
    const agents = registry.getAllAgents().map(a => ({
      ...registry.getPublicAgent(a.id),
      ...getAgentStatus(a.id)
    }))
    res.success(agents)
  })

  // ── POST /api/agents ─────────────────────────────────────────
  router.post("/", validate(CreateAgentSchema), (req, res) => {
    const { id, name, personality, voice, avatar, theme } = req.body

    try {
      registry.addAgent({ id, name, personality, voice, avatar, theme })

      // Add to default room
      const room = roomManager.getRoom(DEFAULT_ROOM_ID)
      if (room) {
        room.agents[id] = { id, name, status: "offline", connected: false, socketId: null }
        broadcastRoomState(room)
      }

      res.status(201).success({
        ...registry.getPublicAgent(id),
        status: "offline",
        connected: false
      })
    } catch (err) {
      if (err.message.includes("already exists")) {
        return res.fail("CONFLICT", err.message, 409)
      }
      res.fail("VALIDATION_ERROR", err.message, 400)
    }
  })

  // ── GET /api/agents/:id ──────────────────────────────────────
  router.get("/:id", (req, res) => {
    const id = req.params.id
    const agent = registry.getAgent(id)
    if (!agent) return res.fail("NOT_FOUND", "Agent not found", 404)

    res.success({
      ...registry.getPublicAgent(id),
      personality: agent.personality || "",
      ...getAgentStatus(id)
    })
  })

  // ── PUT /api/agents/:id ──────────────────────────────────────
  router.put("/:id", validate(UpdateAgentSchema), (req, res) => {
    const id = req.params.id

    try {
      registry.updateAgent(id, req.body)

      // Sync name to all rooms if changed
      if (req.body.name) {
        for (const room of roomManager.rooms.values()) {
          if (room.agents[id]) room.agents[id].name = req.body.name
        }
      }

      res.success({
        ...registry.getPublicAgent(id),
        ...getAgentStatus(id)
      })
    } catch (err) {
      if (err.message.includes("not found")) {
        return res.fail("NOT_FOUND", err.message, 404)
      }
      res.fail("VALIDATION_ERROR", err.message, 400)
    }
  })

  // ── DELETE /api/agents/:id ───────────────────────────────────
  router.delete("/:id", (req, res) => {
    const id = req.params.id

    try {
      registry.removeAgent(id)
    } catch (err) {
      if (err.message.includes("not found")) {
        return res.fail("NOT_FOUND", err.message, 404)
      }
      return res.fail("INTERNAL_ERROR", err.message, 500)
    }

    // Clean up agent from all rooms
    for (const room of roomManager.rooms.values()) {
      if (room.currentTurn === id) {
        room.currentTurn = null
        room.isProcessing = false
      }
      room.turnQueue = room.turnQueue.filter(aid => aid !== id)
      delete room.agents[id]
      broadcastRoomState(room)
    }

    res.success({ deleted: true, id })
  })

  // ── POST /api/agents/:id/message  (SSE streaming) ───────────
  router.post("/:id/message", validate(MessageSchema), async (req, res) => {
    const id = req.params.id
    const agent = registry.getAgent(id)
    if (!agent) return res.fail("NOT_FOUND", "Agent not found", 404)

    if (provider.type === PROVIDER_TYPES.WEBRTC) {
      return res.fail("UNSUPPORTED", "SSE message streaming is not supported with the WebRTC provider. Use Socket.IO instead.", 400)
    }

    const { text, from } = req.body
    const chatText = formatChatForLLM(from, text)

    // Use specified room or default
    const roomId = req.query.room || DEFAULT_ROOM_ID
    if (roomId !== DEFAULT_ROOM_ID && !validateRoomId(roomId)) {
      return res.fail("VALIDATION_ERROR", "Invalid room ID format", 400)
    }
    const room = roomManager.getRoom(roomId)
    if (!room) return res.fail("NOT_FOUND", "Room not found", 404)

    // Record user message in room
    const userMsg = {
      id: Date.now().toString(),
      agentId: -1,
      name: from,
      text,
      timestamp: Date.now(),
      isUser: true
    }
    room.messages.push(userMsg)
    spaceNS.to(room.id).emit("textComplete", userMsg)
    roomManager.touchRoom(room.id)

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    })

    const messageId = Date.now().toString()
    let fullText = ""
    const streamTimeoutMs = parseInt(process.env.STREAM_TIMEOUT_MS) || STREAM_TIMEOUT_MS
    const ac = new AbortController()
    const streamTimer = setTimeout(() => ac.abort(), streamTimeoutMs)

    try {
      if (room.agents[id]) room.agents[id].status = "speaking"
      spaceNS.to(room.id).emit("agentStatus", { agentId: id, status: "speaking", name: agent.name })
      broadcastRoomState(room)

      const systemPrompt = registry.getSystemPrompt(id)
      for await (const delta of provider.streamResponse(id, chatText, systemPrompt, room.id)) {
        if (ac.signal.aborted) throw new Error("Stream timeout — provider took too long to respond")
        fullText += delta
        res.write(`data: ${JSON.stringify({ delta })}\n\n`)
        spaceNS.to(room.id).emit("textDelta", { agentId: id, delta, messageId, name: agent.name })
      }

      // Record agent message
      const agentMsg = { id: messageId, agentId: id, name: agent.name, text: fullText, timestamp: Date.now() }
      room.messages.push(agentMsg)
      spaceNS.to(room.id).emit("textComplete", agentMsg)

      res.write(`data: ${JSON.stringify({ done: true, fullText })}\n\n`)
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: true, message: err.message })}\n\n`)
    } finally {
      clearTimeout(streamTimer)
      if (room.agents[id]) room.agents[id].status = "idle"
      spaceNS.to(room.id).emit("agentStatus", { agentId: id, status: "idle", name: agent.name })
      broadcastRoomState(room)
      res.end()
    }
  })

  // ── GET /api/agents/:id/history ──────────────────────────────
  router.get("/:id/history", (req, res) => {
    const id = req.params.id
    if (!registry.getAgent(id)) return res.fail("NOT_FOUND", "Agent not found", 404)

    const roomId = req.query.room || DEFAULT_ROOM_ID
    if (roomId !== DEFAULT_ROOM_ID && !validateRoomId(roomId)) {
      return res.fail("VALIDATION_ERROR", "Invalid room ID format", 400)
    }
    const room = roomManager.getRoom(roomId)
    if (!room) return res.fail("NOT_FOUND", "Room not found", 404)

    const parsed = Number(req.query.limit)
    const limit = Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)

    // Messages sent by this agent or user messages
    const agentMessages = room.messages.filter(
      m => m.agentId === id || m.agentId === -1
    )

    res.success(agentMessages.slice(-limit))
  })

  return router
}


