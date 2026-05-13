// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { PROVIDER_TYPES, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require("../constants")
const { Router } = require("express")
const { z } = require("zod")
const { validate } = require("../middleware/validate")
const { sanitizeMessage } = require("../middleware/sanitize")
const { messageLimiter } = require("../middleware/rate-limit")
const { logger } = require("../logger")

const SaySchema = z.object({
  text: z.string().min(1).max(5000)
})

const PromptSchema = z.object({
  systemPrompt: z.string().min(1).max(10000)
})

const PersonalityAssignSchema = z.object({
  personalityId: z.string().min(1).max(100)
})

/**
 * Agent control routes: lifecycle, say, prompt, mute, history management.
 * Mounted at /api/agent
 *
 * @param {object} deps
 * @param {object} deps.registry - AgentRegistry instance
 * @param {object} deps.spaceState - shared server state
 * @param {object} deps.provider - LLM provider
 * @param {object} deps.spaceNS - Socket.IO namespace
 * @param {Function} deps.broadcastState
 * @param {Function} deps.handleLLMResponse - handles full LLM pipeline
 * @param {object} deps.personalityStore - personality store (optional)
 */
module.exports = function createAgentControlRoutes(deps) {
  const {
    registry, spaceState, provider, spaceNS,
    broadcastState, handleLLMResponse, personalityStore
  } = deps
  const router = Router()

  // ── Agent Lifecycle ────────────────────────────────────────────

  // POST /api/agent/start — start agent system
  router.post("/start", (req, res) => {
    const { headless } = req.body || {}

    // Reset all agents to idle state
    for (const agent of registry.getAllAgents()) {
      if (!spaceState.agents[agent.id]) {
        spaceState.agents[agent.id] = {
          id: agent.id,
          name: agent.name,
          status: "offline",
          connected: false
        }
      }
    }

    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    broadcastState()

    res.json({ status: "launching", sessionId, headless: !!headless })
  })

  // POST /api/agent/join — join a space/room
  router.post("/join", (req, res) => {
    const { spaceUrl, agents: agentConfigs } = req.body || {}

    if (!spaceUrl || typeof spaceUrl !== "string") {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "spaceUrl is required" }
      })
    }

    // If specific agent configs provided, validate they exist
    if (agentConfigs && Array.isArray(agentConfigs)) {
      for (const cfg of agentConfigs) {
        if (cfg.id && !registry.getAgent(cfg.id)) {
          return res.status(404).json({
            error: { code: "NOT_FOUND", message: `Agent "${cfg.id}" not found` }
          })
        }
      }
    }

    // Mark agents as connecting
    for (const id in spaceState.agents) {
      spaceState.agents[id].status = "idle"
      spaceState.agents[id].connected = true
    }
    broadcastState()

    spaceNS.emit("agent:status", { status: "joining", spaceUrl })

    res.json({ status: "joining", spaceUrl })
  })

  // POST /api/agent/leave — leave current space
  router.post("/leave", (req, res) => {
    // Disconnect all agents
    for (const id in spaceState.agents) {
      spaceState.agents[id].status = "offline"
      spaceState.agents[id].connected = false
    }
    spaceState.currentTurn = null
    spaceState.turnQueue = []
    spaceState.isProcessing = false

    broadcastState()
    spaceNS.emit("agent:status", { status: "disconnected" })

    res.json({ status: "disconnected" })
  })

  // POST /api/agent/stop — stop the agent system
  router.post("/stop", (req, res) => {
    for (const id in spaceState.agents) {
      spaceState.agents[id].status = "offline"
      spaceState.agents[id].connected = false
    }
    spaceState.currentTurn = null
    spaceState.turnQueue = []
    spaceState.isProcessing = false

    broadcastState()
    spaceNS.emit("agent:status", { status: "stopped" })

    res.json({ status: "stopped" })
  })

  // GET /api/agent/status — overall agent system status
  router.get("/status", (req, res) => {
    const agents = registry.getAllAgents().map(a => {
      const state = spaceState.agents[a.id]
      return {
        id: a.id,
        name: a.name,
        status: state ? state.status : "offline",
        connected: state ? state.connected : false,
        muted: state ? !!state.muted : false
      }
    })

    res.json({
      status: spaceState.isProcessing ? "processing" : "idle",
      spaceUrl: spaceState.spaceUrl || null,
      agents,
      uptime: Math.floor(process.uptime()),
      stats: {
        messagesProcessed: spaceState.messages.length,
        currentTurn: spaceState.currentTurn,
        turnQueueLength: spaceState.turnQueue.length
      }
    })
  })

  // ── Agent Control ──────────────────────────────────────────────

  // POST /api/agent/:id/say — queue a message for the agent to speak
  router.post("/:id/say", messageLimiter, validate(SaySchema), async (req, res) => {
    const id = req.params.id
    const agent = registry.getAgent(id)
    if (!agent) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Agent not found" }
      })
    }

    if (provider.type === PROVIDER_TYPES.WEBRTC) {
      return res.status(400).json({
        error: { code: "UNSUPPORTED", message: "Direct say not supported with WebRTC provider" }
      })
    }

    if (spaceState.agents[id]?.muted) {
      return res.status(400).json({
        error: { code: "AGENT_MUTED", message: "Agent is muted" }
      })
    }

    const text = sanitizeMessage(req.body.text)
    const position = spaceState.turnQueue.length + (spaceState.isProcessing ? 1 : 0)

    try {
      await handleLLMResponse(null, id, text)
      res.json({ queued: true, position, completed: true })
    } catch (err) {
      logger.error({ err: err.message, agentId: id }, "Say command failed")
      res.status(500).json({
        error: { code: "LLM_ERROR", message: `Say failed: ${err.message}` }
      })
    }
  })

  // POST /api/agent/:id/prompt — update agent's system prompt
  router.post("/:id/prompt", validate(PromptSchema), (req, res) => {
    const id = req.params.id
    if (!registry.getAgent(id)) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Agent not found" }
      })
    }

    registry.updateAgent(id, { personality: req.body.systemPrompt })
    res.json({ updated: true })
  })

  // POST /api/agent/:id/mute
  router.post("/:id/mute", (req, res) => {
    const id = req.params.id
    if (!spaceState.agents[id]) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Agent not found" }
      })
    }

    spaceState.agents[id].muted = true
    spaceNS.emit("agentStatus", { agentId: id, status: "muted", name: spaceState.agents[id].name })
    broadcastState()
    res.json({ muted: true })
  })

  // POST /api/agent/:id/unmute
  router.post("/:id/unmute", (req, res) => {
    const id = req.params.id
    if (!spaceState.agents[id]) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Agent not found" }
      })
    }

    spaceState.agents[id].muted = false
    const status = spaceState.agents[id].connected ? "idle" : "offline"
    spaceState.agents[id].status = status
    spaceNS.emit("agentStatus", { agentId: id, status, name: spaceState.agents[id].name })
    broadcastState()
    res.json({ muted: false })
  })

  // GET /api/agent/:id/history — get agent's conversation history
  router.get("/:id/history", (req, res) => {
    const id = req.params.id
    if (!registry.getAgent(id)) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Agent not found" }
      })
    }

    const parsed = Number(req.query.limit)
    const limit = Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    const offset = Math.max(parseInt(req.query.offset) || 0, 0)

    const agentMessages = spaceState.messages.filter(
      m => m.agentId === id || m.agentId === -1
    )
    const total = agentMessages.length
    const messages = agentMessages.slice(offset, offset + limit)

    res.json({ messages, total })
  })

  // DELETE /api/agent/:id/history — clear agent's conversation history
  router.delete("/:id/history", (req, res) => {
    const id = req.params.id
    if (!registry.getAgent(id)) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Agent not found" }
      })
    }

    // Remove this agent's messages from global state
    spaceState.messages = spaceState.messages.filter(
      m => m.agentId !== id
    )

    // Clear provider-level history
    if (provider.clearHistory) provider.clearHistory(id)

    res.json({ cleared: true })
  })

  // POST /api/agent/:id/personality — assign a personality preset
  router.post("/:id/personality", validate(PersonalityAssignSchema), (req, res) => {
    const id = req.params.id
    const agent = registry.getAgent(id)
    if (!agent) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Agent not found" }
      })
    }

    if (!personalityStore) {
      return res.status(501).json({
        error: { code: "NOT_IMPLEMENTED", message: "Personality system not enabled" }
      })
    }

    const personality = personalityStore.get(req.body.personalityId)
    if (!personality) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: `Personality "${req.body.personalityId}" not found` }
      })
    }

    registry.updateAgent(id, { personality: personality.prompt })
    if (personality.voice) {
      registry.updateAgent(id, { voice: personality.voice })
    }

    res.json({ updated: true, personalityId: req.body.personalityId })
  })

  return router
}


