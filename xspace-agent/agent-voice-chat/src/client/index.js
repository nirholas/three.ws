// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

/**
 * XSpace Agent API Client
 *
 * Lightweight client for programmatic access to the Agent Voice Chat API.
 * Works in both Node.js and browser environments.
 *
 * Usage:
 *   const { XSpaceClient } = require('agent-voice-chat/src/client')
 *   const client = new XSpaceClient({ baseUrl: 'http://localhost:3000', token: 'your-token' })
 *
 *   await client.join('https://x.com/i/spaces/1abc...')
 *   client.on('transcription', ({ speaker, text }) => console.log(`${speaker}: ${text}`))
 *   const status = await client.getStatus()
 */

// Use dynamic import for socket.io-client to allow both node and browser usage
let io
try {
  io = require("socket.io-client")
} catch {
  // In browser environments, io is expected to be globally available
}

class XSpaceClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl - Server base URL (e.g. http://localhost:3000)
   * @param {string} [options.token] - Bearer token for authentication
   * @param {boolean} [options.autoConnect=true] - Auto-connect WebSocket
   */
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || "http://localhost:3000").replace(/\/$/, "")
    this.token = options.token || null
    this.socket = null
    this._listeners = new Map()

    if (options.autoConnect !== false) {
      this.connect()
    }
  }

  // ── HTTP helpers ───────────────────────────────────────────────

  _headers() {
    const h = { "Content-Type": "application/json" }
    if (this.token) h["Authorization"] = `Bearer ${this.token}`
    return h
  }

  async _fetch(method, path, body) {
    const url = `${this.baseUrl}${path}`
    const opts = {
      method,
      headers: this._headers()
    }
    if (body !== undefined) {
      opts.body = JSON.stringify(body)
    }

    // Use global fetch (Node 18+ or browser)
    const res = await fetch(url, opts)
    const contentType = res.headers.get("content-type") || ""

    if (contentType.includes("text/plain")) {
      return res.text()
    }

    const json = await res.json()
    if (!res.ok) {
      const err = new Error(json?.error?.message || `HTTP ${res.status}`)
      err.code = json?.error?.code || "HTTP_ERROR"
      err.status = res.status
      err.details = json?.error?.details
      throw err
    }
    return json
  }

  _get(path) { return this._fetch("GET", path) }
  _post(path, body) { return this._fetch("POST", path, body) }
  _put(path, body) { return this._fetch("PUT", path, body) }
  _delete(path) { return this._fetch("DELETE", path) }

  // ── WebSocket ──────────────────────────────────────────────────

  /**
   * Connect to the Socket.IO server
   */
  connect() {
    const ioLib = io || (typeof window !== "undefined" && window.io)
    if (!ioLib) {
      console.warn("[XSpaceClient] socket.io-client not available, WebSocket features disabled")
      return
    }

    this.socket = ioLib(`${this.baseUrl}/space`, {
      auth: this.token ? { token: this.token } : undefined,
      transports: ["websocket"]
    })

    this.socket.on("connect", () => {
      this._emit("connected", { id: this.socket.id })
    })

    this.socket.on("disconnect", (reason) => {
      this._emit("disconnected", { reason })
    })

    // Forward spec-compliant events
    const forwardEvents = [
      "agent:status", "agent:transcription", "agent:response",
      "agent:speaking", "agent:error",
      "stateUpdate", "turnGranted", "agentStatus",
      "textDelta", "textComplete",
      "ttsAudio", "ttsBrowser",
      "audioLevel", "messageHistory", "metrics",
      "space:speaker-joined", "space:speaker-left", "space:ended"
    ]

    for (const event of forwardEvents) {
      this.socket.on(event, (data) => {
        // Map to simpler event names for convenience
        const simpleName = event.replace("agent:", "").replace("space:", "")
        this._emit(event, data)
        if (simpleName !== event) this._emit(simpleName, data)
      })
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
  }

  /**
   * Subscribe to specific event categories
   * @param {string[]} categories - e.g. ['transcription', 'metrics', 'errors']
   */
  subscribe(categories) {
    if (this.socket) {
      this.socket.emit("subscribe", categories)
    }
  }

  // ── Event emitter ──────────────────────────────────────────────

  /**
   * Listen for events
   * @param {string} event
   * @param {Function} callback
   * @returns {XSpaceClient} this (for chaining)
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set())
    }
    this._listeners.get(event).add(callback)
    return this
  }

  /**
   * Remove event listener
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    const listeners = this._listeners.get(event)
    if (listeners) listeners.delete(callback)
    return this
  }

  _emit(event, data) {
    const listeners = this._listeners.get(event)
    if (listeners) {
      for (const cb of listeners) {
        try { cb(data) } catch (e) { console.error(`[XSpaceClient] Error in ${event} listener:`, e) }
      }
    }
  }

  // ── Agent Lifecycle ────────────────────────────────────────────

  /** Start the agent system */
  start(options = {}) {
    return this._post("/api/agent/start", options)
  }

  /** Join an X Space */
  join(spaceUrl, agents) {
    return this._post("/api/agent/join", { spaceUrl, agents })
  }

  /** Leave current Space */
  leave() {
    return this._post("/api/agent/leave")
  }

  /** Stop the agent system */
  stop() {
    return this._post("/api/agent/stop")
  }

  /** Get agent system status */
  getStatus() {
    return this._get("/api/agent/status")
  }

  // ── Agent Control ──────────────────────────────────────────────

  /** Queue a message for an agent to speak */
  say(agentId, text) {
    return this._post(`/api/agent/${agentId}/say`, { text })
  }

  /** Update an agent's system prompt */
  setPrompt(agentId, systemPrompt) {
    return this._post(`/api/agent/${agentId}/prompt`, { systemPrompt })
  }

  /** Mute an agent */
  mute(agentId) {
    return this._post(`/api/agent/${agentId}/mute`)
  }

  /** Unmute an agent */
  unmute(agentId) {
    return this._post(`/api/agent/${agentId}/unmute`)
  }

  /** Get agent conversation history */
  getHistory(agentId, options = {}) {
    const params = new URLSearchParams()
    if (options.limit) params.set("limit", options.limit)
    if (options.offset) params.set("offset", options.offset)
    const qs = params.toString()
    return this._get(`/api/agent/${agentId}/history${qs ? "?" + qs : ""}`)
  }

  /** Clear agent conversation history */
  clearHistory(agentId) {
    return this._delete(`/api/agent/${agentId}/history`)
  }

  /** Assign a personality to an agent */
  setPersonality(agentId, personalityId) {
    return this._post(`/api/agent/${agentId}/personality`, { personalityId })
  }

  // ── Agent CRUD ─────────────────────────────────────────────────

  /** List all agents */
  listAgents() {
    return this._get("/api/agents")
  }

  /** Get agent details */
  getAgent(agentId) {
    return this._get(`/api/agents/${agentId}`)
  }

  /** Create a new agent */
  createAgent(config) {
    return this._post("/api/agents", config)
  }

  /** Update an agent */
  updateAgent(agentId, updates) {
    return this._put(`/api/agents/${agentId}`, updates)
  }

  /** Delete an agent */
  deleteAgent(agentId) {
    return this._delete(`/api/agents/${agentId}`)
  }

  /**
   * Send a message to an agent and get SSE streaming response
   * @param {string} agentId
   * @param {string} text
   * @param {object} [options]
   * @param {string} [options.from]
   * @param {Function} [options.onDelta] - called with each text delta
   * @returns {Promise<string>} full response text
   */
  async sendMessage(agentId, text, options = {}) {
    const url = `${this.baseUrl}/api/agents/${agentId}/message`
    const res = await fetch(url, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify({ text, from: options.from || "api-user" })
    })

    if (!res.ok) {
      const json = await res.json()
      throw new Error(json?.error?.message || `HTTP ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split("\n")

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        try {
          const data = JSON.parse(line.slice(6))
          if (data.delta && options.onDelta) {
            options.onDelta(data.delta)
          }
          if (data.done) {
            fullText = data.fullText
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }

    return fullText
  }

  // ── Configuration ──────────────────────────────────────────────

  /** Get current configuration */
  getConfig() {
    return this._get("/api/config")
  }

  /** Update configuration */
  updateConfig(config) {
    return this._put("/api/config", config)
  }

  /** List available providers */
  getProviders() {
    return this._get("/api/providers")
  }

  // ── Health & Metrics ───────────────────────────────────────────

  /** Health check */
  getHealth() {
    return this._get("/api/health")
  }

  /** Get metrics snapshot */
  getMetrics() {
    return this._get("/api/metrics")
  }

  // ── Personalities ──────────────────────────────────────────────

  /** List personality presets */
  listPersonalities() {
    return this._get("/api/personalities")
  }

  /** Get a personality preset */
  getPersonality(id) {
    return this._get(`/api/personalities/${id}`)
  }

  /** Create a personality preset */
  createPersonality(config) {
    return this._post("/api/personalities", config)
  }

  /** Update a personality preset */
  updatePersonality(id, updates) {
    return this._put(`/api/personalities/${id}`, updates)
  }

  /** Delete a personality preset */
  deletePersonality(id) {
    return this._delete(`/api/personalities/${id}`)
  }

  // ── Conversations ──────────────────────────────────────────────

  /** List archived conversations */
  listConversations(options = {}) {
    const params = new URLSearchParams()
    if (options.limit) params.set("limit", options.limit)
    if (options.offset) params.set("offset", options.offset)
    if (options.search) params.set("search", options.search)
    const qs = params.toString()
    return this._get(`/api/conversations${qs ? "?" + qs : ""}`)
  }

  /** Get a conversation */
  getConversation(id) {
    return this._get(`/api/conversations/${id}`)
  }

  /** Get conversation transcript */
  getTranscript(id, format = "text") {
    return this._get(`/api/conversations/${id}/transcript?format=${format}`)
  }

  /** Delete a conversation */
  deleteConversation(id) {
    return this._delete(`/api/conversations/${id}`)
  }

  /** Archive current session */
  archiveConversation(title) {
    return this._post("/api/conversations", { title })
  }

  /** Get conversation statistics */
  getConversationStats() {
    return this._get("/api/conversations/stats")
  }

  // ── Socket.IO shortcuts ────────────────────────────────────────

  /** Emit agent:say via WebSocket */
  wsSay(agentId, text) {
    if (this.socket) {
      this.socket.emit("agent:say", { agentId, text })
    }
  }

  /** Emit agent:join via WebSocket */
  wsJoin(spaceUrl) {
    if (this.socket) {
      this.socket.emit("agent:join", { spaceUrl })
    }
  }

  /** Emit agent:leave via WebSocket */
  wsLeave() {
    if (this.socket) {
      this.socket.emit("agent:leave")
    }
  }
}

module.exports = { XSpaceClient }


