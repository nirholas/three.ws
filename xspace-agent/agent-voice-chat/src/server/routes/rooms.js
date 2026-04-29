// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { PROVIDER_TYPES, STREAM_TIMEOUT_MS, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require("../constants")
const { Router } = require("express")
const { z } = require("zod")
const { validate } = require("../middleware/validate")
const { validateRoomId, sanitizeMessage, formatChatForLLM } = require("../middleware/sanitize")

const CreateRoomSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(100).optional(),
  agentIds: z.array(z.string().min(1)).min(1).max(10).optional(),
  maxParticipants: z.number().int().min(1).max(100).optional(),
  ttlMinutes: z.number().int().min(0).optional(),
  isPublic: z.boolean().optional()
})

const RoomMessageSchema = z.object({
  text: z.string().min(1).max(5000),
  from: z.string().min(1).max(100).optional().default("api-user"),
  targetAgentId: z.string().min(1).optional()
})

/**
 * @param {object} deps
 * @param {import('../../../agent-registry')} deps.registry
 * @param {import('../../../room-manager').RoomManager} deps.roomManager
 * @param {string} deps.DEFAULT_ROOM_ID
 * @param {object} deps.provider
 * @param {object} deps.spaceNS
 */
module.exports = function createRoomRoutes(deps) {
  const { registry, roomManager, DEFAULT_ROOM_ID, provider, spaceNS } = deps
  const router = Router()

  // ── GET /api/rooms ───────────────────────────────────────────
  router.get("/", (req, res) => {
    res.success(roomManager.listRooms())
  })

  // ── POST /api/rooms ──────────────────────────────────────────
  router.post("/", validate(CreateRoomSchema), (req, res) => {
    const config = req.body || {}

    // Validate agent IDs if provided
    if (config.agentIds) {
      const missing = config.agentIds.filter(id => !registry.getAgent(id))
      if (missing.length > 0) {
        return res.fail("VALIDATION_ERROR", `Agent(s) not found: ${missing.join(", ")}`, 400)
      }
    }

    const room = roomManager.createRoom(config)
    res.status(201).success({
      id: room.id,
      agents: room.agents,
      config: room.config,
      createdAt: room.createdAt
    })
  })

  // ── GET /api/rooms/:id ───────────────────────────────────────
  router.get("/:id", (req, res) => {
    if (!validateRoomId(req.params.id)) return res.fail("VALIDATION_ERROR", "Invalid room ID format", 400)
    const room = roomManager.getRoom(req.params.id)
    if (!room) return res.fail("NOT_FOUND", "Room not found", 404)

    res.success({
      id: room.id,
      agents: room.agents,
      currentTurn: room.currentTurn,
      clientCount: room.clients.size,
      messageCount: room.messages.length,
      createdAt: room.createdAt,
      lastActivity: room.lastActivity,
      config: room.config
    })
  })

  // ── GET /api/rooms/:id/messages ──────────────────────────────
  router.get("/:id/messages", (req, res) => {
    if (!validateRoomId(req.params.id)) return res.fail("VALIDATION_ERROR", "Invalid room ID format", 400)
    const room = roomManager.getRoom(req.params.id)
    if (!room) return res.fail("NOT_FOUND", "Room not found", 404)

    const parsed = Number(req.query.limit)
    const limit = Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    res.success(room.messages.slice(-limit))
  })

  // ── POST /api/rooms/:id/message ──────────────────────────────
  router.post("/:id/message", validate(RoomMessageSchema), async (req, res) => {
    if (!validateRoomId(req.params.id)) return res.fail("VALIDATION_ERROR", "Invalid room ID format", 400)
    const room = roomManager.getRoom(req.params.id)
    if (!room) return res.fail("NOT_FOUND", "Room not found", 404)

    if (provider.type === PROVIDER_TYPES.WEBRTC) {
      return res.fail("UNSUPPORTED", "REST messaging not supported with WebRTC provider", 400)
    }

    const { text, from, targetAgentId } = req.body

    // Record user message
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

    // Determine which agent responds
    const agentIds = Object.keys(room.agents)
    let responderId
    if (targetAgentId) {
      if (!room.agents[targetAgentId]) {
        return res.fail("VALIDATION_ERROR", `Agent "${targetAgentId}" is not in this room`, 400)
      }
      responderId = targetAgentId
    } else {
      responderId = agentIds[0]
    }

    if (!responderId) return res.fail("NOT_FOUND", "No agents in this room", 404)

    const agent = registry.getAgent(responderId)
    if (!agent) return res.fail("NOT_FOUND", "Responding agent not found in registry", 404)

    const chatText = formatChatForLLM(from, text)
    const messageId = Date.now().toString()
    let fullText = ""
    const streamTimeoutMs = parseInt(process.env.STREAM_TIMEOUT_MS) || STREAM_TIMEOUT_MS
    const ac = new AbortController()
    const streamTimer = setTimeout(() => ac.abort(), streamTimeoutMs)

    try {
      const systemPrompt = registry.getSystemPrompt(responderId)
      for await (const delta of provider.streamResponse(responderId, chatText, systemPrompt, room.id)) {
        if (ac.signal.aborted) throw new Error("Stream timeout — provider took too long to respond")
        fullText += delta
      }

      const agentMsg = {
        id: messageId,
        agentId: responderId,
        name: agent.name,
        text: fullText,
        timestamp: Date.now()
      }
      room.messages.push(agentMsg)
      spaceNS.to(room.id).emit("textComplete", agentMsg)

      res.success({
        message: agentMsg,
        room: { id: room.id, messageCount: room.messages.length }
      })
    } catch (err) {
      res.fail("LLM_ERROR", `Failed to get response: ${err.message}`, 500)
    } finally {
      clearTimeout(streamTimer)
    }
  })

  // ── DELETE /api/rooms/:id ────────────────────────────────────
  router.delete("/:id", (req, res) => {
    const roomId = req.params.id
    if (!validateRoomId(roomId)) return res.fail("VALIDATION_ERROR", "Invalid room ID format", 400)
    if (roomId === DEFAULT_ROOM_ID) {
      return res.fail("FORBIDDEN", "Cannot delete the default room", 403)
    }

    const room = roomManager.getRoom(roomId)
    if (!room) return res.fail("NOT_FOUND", "Room not found", 404)

    // Notify clients in the room
    spaceNS.to(roomId).emit("roomDeleted", { roomId })

    // Clear provider history if supported
    if (provider.clearRoomHistory) provider.clearRoomHistory(roomId)

    roomManager.deleteRoom(roomId)
    res.success({ deleted: true, id: roomId })
  })

  return router
}


