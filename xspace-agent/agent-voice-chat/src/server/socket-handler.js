// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { createSocketRateLimiter } = require("./middleware/rate-limit")
const { sanitizeMessage, validateAgentId } = require("./middleware/sanitize")
const { socketAuth } = require("./middleware/auth")
const { createTurnManager } = require("./turn-manager-utils")
const { logger, safeMessage } = require("./logger")
const {
  MAX_MESSAGES_PER_ROOM, MAX_HISTORY_SLICE, PROVIDER_TYPES,
  METRICS_BROADCAST_INTERVAL_MS, SOCKET_AGENT_SAY_RATE_LIMIT,
  SOCKET_MESSAGE_RATE_LIMIT, SOCKET_AUDIO_RATE_LIMIT
} = require("./constants")

/**
 * Refactored Socket.IO event handler matching the API spec.
 *
 * Server → Client events:
 *   agent:status, agent:transcription, agent:response, agent:speaking,
 *   agent:error, metrics, space:speaker-joined, space:speaker-left, space:ended,
 *   stateUpdate, turnGranted, agentStatus, textDelta, textComplete,
 *   ttsAudio, ttsBrowser, audioLevel, messageHistory
 *
 * Client → Server events:
 *   agent:start, agent:join, agent:leave, agent:stop, agent:say, agent:2fa,
 *   config:update, subscribe,
 *   agentConnect, agentDisconnect, statusChange, requestTurn, releaseTurn,
 *   audioData, userMessage, textToAgentDirect, textDelta, textComplete, audioLevel
 *
 * @param {object} deps
 * @param {import('socket.io').Namespace} deps.spaceNS
 * @param {object} deps.spaceState
 * @param {object} deps.registry
 * @param {object} deps.provider
 * @param {object} deps.stt
 * @param {object} deps.tts
 * @param {object} deps.metrics
 * @param {string} deps.AI_PROVIDER
 */
module.exports = function setupSocketHandler(deps) {
  const {
    spaceNS, spaceState, registry, provider, stt, tts, metrics, AI_PROVIDER
  } = deps

  const socketLimiter = createSocketRateLimiter()

  // ── Helpers ──────────────────────────────────────────────────

  function broadcastState() {
    spaceNS.emit("stateUpdate", {
      agents: spaceState.agents,
      currentTurn: spaceState.currentTurn,
      turnQueue: spaceState.turnQueue
    })
  }

  // Use shared turn management logic
  const turnManager = createTurnManager(
    spaceState,
    {
      broadcast: broadcastState,
      grantTurn: (agentId) => spaceNS.emit("turnGranted", { agentId })
    }
  )
  const { requestTurn, releaseTurn } = turnManager

  function isWallet(str) {
    return str && str.length >= 32 && /^[a-zA-Z0-9]+$/.test(str)
  }

  function shortenNick(name) {
    if (isWallet(name)) return name.slice(0, 4) + "..." + name.slice(-4)
    return name
  }

  async function handleLLMResponse(socket, agentId, userText) {
    requestTurn(agentId)
    const messageId = Date.now().toString()
    const agentName = spaceState.agents[agentId]?.name

    spaceNS.emit("agentStatus", { agentId, status: "speaking", name: agentName })
    if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "speaking"
    broadcastState()

    // Emit spec-compliant event
    spaceNS.emit("agent:speaking", { agentId, duration: 0 })

    const systemPrompt = registry.getSystemPrompt(agentId)
    const voice = registry.getVoice(agentId)

    let fullText = ""
    const startTime = Date.now()

    try {
      for await (const delta of provider.streamResponse(agentId, userText, systemPrompt)) {
        fullText += delta
        spaceNS.emit("textDelta", { agentId, delta, messageId, name: agentName })
      }

      const msg = { id: messageId, agentId, name: agentName, text: fullText, timestamp: Date.now() }
      spaceState.messages.push(msg)
      if (spaceState.messages.length > MAX_MESSAGES_PER_ROOM) spaceState.messages = spaceState.messages.slice(-MAX_MESSAGES_PER_ROOM)
      spaceNS.emit("textComplete", msg)

      // Spec-compliant event
      spaceNS.emit("agent:response", { agentId, text: fullText, timestamp: new Date().toISOString() })

      // Track metrics
      if (metrics) {
        metrics.recordLLMCall(fullText.length, Date.now() - startTime)
      }

      // TTS
      const targetSocket = socket || spaceNS
      try {
        const ttsStart = Date.now()
        const audioBuffer = await tts.synthesize(fullText, agentId, voice)
        if (metrics) metrics.recordTTSCall(Date.now() - ttsStart)

        if (audioBuffer) {
          targetSocket.emit("ttsAudio", { agentId, audio: audioBuffer.toString("base64"), format: tts.TTS_FORMAT || "mp3" })
        } else {
          targetSocket.emit("ttsBrowser", { agentId, text: fullText })
        }
      } catch (ttsErr) {
        const ttsErrData = ttsErr.response?.data
        const ttsErrMsg = Buffer.isBuffer(ttsErrData) ? ttsErrData.toString("utf8") : (ttsErrData || ttsErr.message)
        logger.error({ err: ttsErrMsg, agentId }, "TTS error")
        if (metrics) metrics.recordTTSError()
        targetSocket.emit("ttsBrowser", { agentId, text: fullText })
      }
    } catch (err) {
      logger.error({ err: err.message, agentId, provider: AI_PROVIDER }, "LLM error")
      if (metrics) metrics.recordLLMError()
      spaceNS.emit("agent:error", { code: "PROVIDER_ERROR", message: err.message })
    } finally {
      if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "idle"
      spaceNS.emit("agentStatus", { agentId, status: "idle", name: agentName })
      releaseTurn(agentId)
    }
  }

  // ── Metrics broadcast interval ─────────────────────────────

  const metricsSubscribers = new Set()
  let metricsInterval = null

  function startMetricsBroadcast() {
    if (metricsInterval) return
    metricsInterval = setInterval(() => {
      if (metricsSubscribers.size === 0) return
      const snapshot = metrics ? metrics.getSnapshot() : {}
      for (const socketId of metricsSubscribers) {
        const sock = spaceNS.sockets.get(socketId)
        if (sock) sock.emit("metrics", snapshot)
      }
    }, METRICS_BROADCAST_INTERVAL_MS)
  }

  function stopMetricsBroadcast() {
    if (metricsInterval) {
      clearInterval(metricsInterval)
      metricsInterval = null
    }
  }

  startMetricsBroadcast()

  // ── Socket.IO auth middleware (shared) ─────────────────────

  spaceNS.use(socketAuth)

  // ── Connection handler ─────────────────────────────────────

  spaceNS.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Client connected")

    // Send initial state
    socket.emit("stateUpdate", {
      agents: spaceState.agents,
      currentTurn: spaceState.currentTurn,
      turnQueue: spaceState.turnQueue
    })
    socket.emit("messageHistory", spaceState.messages.slice(-MAX_HISTORY_SLICE))

    // ── Subscription model ─────────────────────────────────
    socket.on("subscribe", (categories) => {
      if (!Array.isArray(categories)) return
      socket._subscriptions = new Set(categories)

      if (categories.includes("metrics")) {
        metricsSubscribers.add(socket.id)
      }
    })

    // ── Spec: Client → Server events ────────────────────────

    // agent:start
    socket.on("agent:start", (data) => {
      for (const agent of registry.getAllAgents()) {
        if (!spaceState.agents[agent.id]) {
          spaceState.agents[agent.id] = {
            id: agent.id, name: agent.name, status: "offline", connected: false
          }
        }
      }
      broadcastState()
      socket.emit("agent:status", { status: "launching" })
    })

    // agent:join
    socket.on("agent:join", (data) => {
      const { spaceUrl } = data || {}
      if (!spaceUrl) {
        return socket.emit("agent:error", { code: "VALIDATION_ERROR", message: "spaceUrl required" })
      }
      spaceState.spaceUrl = spaceUrl
      for (const id in spaceState.agents) {
        spaceState.agents[id].status = "idle"
        spaceState.agents[id].connected = true
      }
      broadcastState()
      socket.emit("agent:status", { status: "joining", spaceUrl })
    })

    // agent:leave
    socket.on("agent:leave", () => {
      for (const id in spaceState.agents) {
        spaceState.agents[id].status = "offline"
        spaceState.agents[id].connected = false
      }
      spaceState.currentTurn = null
      spaceState.turnQueue = []
      spaceState.isProcessing = false
      spaceState.spaceUrl = null
      broadcastState()
      socket.emit("agent:status", { status: "disconnected" })
    })

    // agent:stop
    socket.on("agent:stop", () => {
      for (const id in spaceState.agents) {
        spaceState.agents[id].status = "offline"
        spaceState.agents[id].connected = false
      }
      spaceState.currentTurn = null
      spaceState.turnQueue = []
      spaceState.isProcessing = false
      broadcastState()
      socket.emit("agent:status", { status: "stopped" })
    })

    // agent:say — send text to an agent
    socket.on("agent:say", async ({ agentId, text }) => {
      if (!agentId || !text) return
      if (socketLimiter.check(socket.id, "agent:say", SOCKET_AGENT_SAY_RATE_LIMIT)) {
        return socket.emit("agent:error", { code: "RATE_LIMITED", message: "Too many messages" })
      }
      const sanitized = sanitizeMessage(text)
      if (!sanitized) return
      await handleLLMResponse(socket, agentId, sanitized)
    })

    // agent:2fa
    socket.on("agent:2fa", ({ code }) => {
      // Placeholder for 2FA flow
      logger.info("2FA code received")
    })

    // config:update
    socket.on("config:update", (config) => {
      if (config && typeof config === "object") {
        if (config.id && registry.getAgent(config.id)) {
          try { registry.updateAgent(config.id, config) } catch (e) { /* skip */ }
        }
      }
    })

    // ── Legacy events (backward compatible) ──────────────────

    socket.on("agentConnect", ({ agentId }) => {
      if (!spaceState.agents[agentId] && registry.getAgent(agentId)) {
        const agent = registry.getAgent(agentId)
        spaceState.agents[agentId] = { id: agent.id, name: agent.name, status: "offline", connected: false }
      }
      if (spaceState.agents[agentId]) {
        spaceState.agents[agentId].connected = true
        spaceState.agents[agentId].status = "idle"
        spaceState.agents[agentId].socketId = socket.id
        logger.info({ agentId, name: spaceState.agents[agentId].name }, "Agent connected")
        broadcastState()
      }
    })

    socket.on("agentDisconnect", ({ agentId }) => {
      if (spaceState.agents[agentId]) {
        spaceState.agents[agentId].connected = false
        spaceState.agents[agentId].status = "offline"
        if (spaceState.currentTurn === agentId) releaseTurn(agentId)
        spaceState.turnQueue = spaceState.turnQueue.filter(id => id !== agentId)
        logger.info({ agentId }, "Agent disconnected")
        broadcastState()
      }
    })

    socket.on("statusChange", ({ agentId, status }) => {
      if (spaceState.agents[agentId]) {
        spaceState.agents[agentId].status = status
        spaceNS.emit("agentStatus", { agentId, status, name: spaceState.agents[agentId].name })
        broadcastState()
      }
    })

    socket.on("requestTurn", ({ agentId }) => {
      const granted = requestTurn(agentId)
      socket.emit("turnResponse", { granted, currentTurn: spaceState.currentTurn })
    })

    socket.on("releaseTurn", ({ agentId }) => releaseTurn(agentId))

    socket.on("textDelta", ({ agentId, delta, messageId }) => {
      spaceNS.emit("textDelta", { agentId, delta, messageId, name: spaceState.agents[agentId]?.name })
    })

    socket.on("textComplete", ({ agentId, text, messageId }) => {
      const msg = {
        id: messageId,
        agentId,
        name: spaceState.agents[agentId]?.name,
        text,
        timestamp: Date.now()
      }
      spaceState.messages.push(msg)
      if (spaceState.messages.length > MAX_MESSAGES_PER_ROOM) spaceState.messages = spaceState.messages.slice(-MAX_MESSAGES_PER_ROOM)
      spaceNS.emit("textComplete", msg)
    })

    socket.on("audioData", async ({ agentId, audio, mimeType }) => {
      if (provider.type === PROVIDER_TYPES.WEBRTC) return
      if (socketLimiter.check(socket.id, "audioData", SOCKET_AUDIO_RATE_LIMIT)) {
        return socket.emit("agent:error", { code: "RATE_LIMITED", message: "Audio rate limited" })
      }

      try {
        spaceNS.emit("agentStatus", { agentId, status: "listening", name: spaceState.agents[agentId]?.name })
        if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "listening"
        broadcastState()

        const audioBuffer = Buffer.from(audio, "base64")
        const sttStart = Date.now()
        const { text } = await stt.transcribe(audioBuffer, mimeType || "audio/webm")
        if (metrics) metrics.recordSTTCall(Date.now() - sttStart)

        if (!text?.trim()) {
          if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "idle"
          spaceNS.emit("agentStatus", { agentId, status: "idle", name: spaceState.agents[agentId]?.name })
          broadcastState()
          return
        }

        logger.info({ agentId, text: safeMessage(text) }, "STT transcription")

        // Emit spec-compliant transcription event
        spaceNS.emit("agent:transcription", {
          speaker: "User",
          text,
          timestamp: new Date().toISOString()
        })

        const userMsg = { id: Date.now().toString(), agentId: -1, name: "User (voice)", text, timestamp: Date.now(), isUser: true }
        spaceState.messages.push(userMsg)
        spaceNS.emit("textComplete", userMsg)
        await handleLLMResponse(socket, agentId, text)
      } catch (err) {
        logger.error({ err: err.message, agentId }, "Audio pipeline error")
        if (metrics) metrics.recordSTTError()
        if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "idle"
        spaceNS.emit("agentStatus", { agentId, status: "idle", name: spaceState.agents[agentId]?.name })
        spaceNS.emit("agent:error", { code: "BROWSER_ERROR", message: err.message })
        broadcastState()
      }
    })

    socket.on("userMessage", ({ text, from }) => {
      if (socketLimiter.check(socket.id, "userMessage", SOCKET_MESSAGE_RATE_LIMIT)) {
        return socket.emit("agent:error", { code: "RATE_LIMITED", message: "Message rate limited" })
      }

      const msg = { id: Date.now().toString(), agentId: -1, name: from || "User", text, timestamp: Date.now(), isUser: true }
      spaceState.messages.push(msg)
      spaceNS.emit("userMessage", msg)
      spaceNS.emit("textComplete", msg)

      const firstAgent = registry.getAllAgents()[0]
      const targetId = firstAgent ? firstAgent.id : "bob"
      if (provider.type === PROVIDER_TYPES.SOCKET) {
        handleLLMResponse(socket, targetId, `[CHAT - ${shortenNick(from) || "User"}]: ${text}`)
      } else {
        spaceNS.emit("textToAgent", { text, from: shortenNick(from) || "User" })
      }
    })

    socket.on("textToAgentDirect", async ({ agentId, text, from }) => {
      if (provider.type === PROVIDER_TYPES.WEBRTC) return
      const chatText = from ? `[CHAT - ${shortenNick(from)}]: ${text}` : text
      await handleLLMResponse(socket, agentId, chatText)
    })

    socket.on("audioLevel", ({ agentId, level }) => spaceNS.emit("audioLevel", { agentId, level }))

    // ── Disconnect ───────────────────────────────────────────
    socket.on("disconnect", () => {
      for (const id in spaceState.agents) {
        if (spaceState.agents[id].socketId === socket.id) {
          spaceState.agents[id].connected = false
          spaceState.agents[id].status = "offline"
          if (spaceState.currentTurn === id) releaseTurn(id)
          spaceState.turnQueue = spaceState.turnQueue.filter(aid => aid !== id)
        }
      }

      metricsSubscribers.delete(socket.id)
      socketLimiter.cleanup(socket.id)
      broadcastState()
      logger.info({ socketId: socket.id }, "Client disconnected")
    })
  })

  // Return helpers for use by REST routes
  return { broadcastState, handleLLMResponse, requestTurn, releaseTurn, stopMetricsBroadcast }
}


