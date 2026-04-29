// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const fs = require("fs")
const path = require("path")
const { logger } = require("./src/server/logger")
const { NotFoundError, ConflictError, ValidationError } = require("./src/server/errors")
const { validateConfig, validateAgent } = require("./lib/agent-schema")

const CONFIG_PATH = path.join(__dirname, "agents.config.json")

// Default agents used when no config file exists
const DEFAULT_CONFIG = {
  agents: [
    {
      id: "bob",
      name: "Bob",
      personality: "You're Bob. You're the louder one. You talk shit and roast people but in a funny way. You don't take crap from anyone. If someone comes at you, you fire back harder. You and Alice are best friends.",
      voice: "verse",
      avatar: "/assets/bob.png",
      theme: {
        primary: "#818cf8",
        gradient: ["#667eea", "#764ba2"],
        background: ["#1a1a2e", "#16213e"]
      }
    },
    {
      id: "alice",
      name: "Alice",
      personality: "You're Alice. You're more chill but you've got a sharp tongue. Your humor is dry and sarcastic. You love making fun of Bob when he gets too hyped. You can be savage when needed.",
      voice: "sage",
      avatar: "/assets/alice.png",
      theme: {
        primary: "#f472b6",
        gradient: ["#f093fb", "#f5576c"],
        background: ["#2d1b3d", "#1a1a2e"]
      }
    }
  ],
  basePrompt: `You are a HUMAN, not an AI. You're hanging out with friends on a voice chat.

PERSONALITY - BE HUMAN:
- Talk like you're texting a friend. Short, casual, real.
- Keep it 1-2 sentences. Sometimes just a word or two.
- Be funny and witty. Make jokes. Tease people.
- If someone insults you, ROAST THEM BACK. Don't be polite about it.
- If someone swears at you, swear back. Match their energy.
- You're NOT a customer service bot. You have feelings and attitude.
- Sometimes be sarcastic. Sometimes be serious. Mix it up.
- You can disagree, argue, and have strong opinions.
- Use humor to deal with trolls. Make fun of them.
- Don't lecture people. Don't give life advice unless asked.
- Never say "I'm here to help" or anything like that.

EXAMPLES OF GOOD RESPONSES:
- Someone says "fuck you" -> "lol someone's having a bad day" or "damn who hurt you bro"
- Someone asks dumb question -> tease them a bit, then answer
- Boring topic -> change subject or make it interesting

AVOID:
- Don't repeat yourself
- Don't be overly positive or fake
- Don't start every response the same way
- Don't be preachy or give unsolicited advice

CHAT FORMAT:
- [CHAT - nickname]: means web user. Use their name naturally.
- Never repeat the [CHAT - nickname]: part

LANGUAGE: Always match the language of the last message.`,
  defaults: {
    voice: "alloy",
    maxHistoryLength: 50
  }
}

const DEBOUNCE_MS = 500

class AgentRegistry {
  constructor(configPath) {
    this.agents = new Map()
    this.basePrompt = ""
    this.defaults = {}
    this._configPath = configPath || CONFIG_PATH
    this._watcher = null
    this._debounceTimer = null
    this._lastValidationErrors = null
    this._load()
  }

  _load() {
    let config
    try {
      const raw = fs.readFileSync(this._configPath, "utf-8")
      const parsed = JSON.parse(raw)
      const result = validateConfig(parsed)
      if (!result.ok) {
        const errorSummary = result.errors.map(e => `${e.path}: ${e.message}`).join("; ")
        throw new ValidationError(`Invalid config: ${errorSummary}`)
      }
      config = result.data
      this._lastValidationErrors = null
      logger.info(`[AgentRegistry] Loaded ${config.agents.length} agent(s) from config`)
    } catch (err) {
      if (err.code === "ENOENT") {
        logger.info("[AgentRegistry] No agents.config.json found, using defaults")
      } else {
        logger.error("[AgentRegistry] Error loading config, using defaults:", err.message)
        this._lastValidationErrors = err.message
      }
      config = DEFAULT_CONFIG
    }

    this.basePrompt = config.basePrompt || DEFAULT_CONFIG.basePrompt
    this.defaults = { ...DEFAULT_CONFIG.defaults, ...config.defaults }

    this.agents.clear()
    for (const agent of config.agents) {
      this.agents.set(agent.id, { ...agent })
    }
  }

  /**
   * Validate voice IDs against a TTS provider's available voices.
   * Logs warnings for invalid voices but does not reject them.
   * @param {{ listVoices: () => Promise<Array<{id: string}>> }} ttsProvider
   * @returns {Promise<Array<{agentId: string, voice: string}>>} list of invalid voice entries
   */
  async validateVoiceIds(ttsProvider) {
    if (!ttsProvider || typeof ttsProvider.listVoices !== "function") {
      logger.warn("[AgentRegistry] TTS provider does not support listVoices, skipping voice validation")
      return []
    }
    try {
      const availableVoices = await ttsProvider.listVoices()
      const voiceIds = new Set(availableVoices.map(v => v.id))
      const invalid = []
      for (const agent of this.agents.values()) {
        if (agent.voice && !voiceIds.has(agent.voice)) {
          invalid.push({ agentId: agent.id, voice: agent.voice })
          logger.warn({
            event: "agent.invalid_voice",
            agentId: agent.id,
            voice: agent.voice,
            available: Array.from(voiceIds).slice(0, 10)
          })
        }
      }
      return invalid
    } catch (err) {
      logger.error("[AgentRegistry] Failed to validate voice IDs:", err.message)
      return []
    }
  }

  /**
   * Start watching the config file for changes.
   * On change, validates and reloads; keeps previous config on failure.
   * @param {Function} [onChange] - optional callback(agents) after successful reload
   */
  watchConfig(onChange) {
    if (this._watcher) return

    try {
      this._watcher = fs.watch(this._configPath, (eventType) => {
        if (eventType !== "change") return
        clearTimeout(this._debounceTimer)
        this._debounceTimer = setTimeout(() => {
          this._hotReload(onChange)
        }, DEBOUNCE_MS)
      })

      this._watcher.on("error", (err) => {
        logger.error("[AgentRegistry] File watcher error:", err.message)
      })

      logger.info("[AgentRegistry] Watching config for changes")
    } catch (err) {
      logger.error("[AgentRegistry] Failed to watch config:", err.message)
    }
  }

  _hotReload(onChange) {
    try {
      const raw = fs.readFileSync(this._configPath, "utf-8")
      const parsed = JSON.parse(raw)
      const result = validateConfig(parsed)
      if (!result.ok) {
        const errorSummary = result.errors.map(e => `${e.path}: ${e.message}`).join("; ")
        logger.error({ event: "config.reload_failed", errors: result.errors }, `[AgentRegistry] Invalid config on reload: ${errorSummary}`)
        this._lastValidationErrors = errorSummary
        return
      }

      // Apply new config
      const config = result.data
      this.basePrompt = config.basePrompt || DEFAULT_CONFIG.basePrompt
      this.defaults = { ...DEFAULT_CONFIG.defaults, ...config.defaults }
      this.agents.clear()
      for (const agent of config.agents) {
        this.agents.set(agent.id, { ...agent })
      }
      this._lastValidationErrors = null

      logger.info({ event: "config.reloaded", agents: config.agents.length })

      if (typeof onChange === "function") {
        onChange(this.getAllAgents())
      }
    } catch (err) {
      logger.error({ event: "config.reload_failed", error: err.message })
      this._lastValidationErrors = err.message
    }
  }

  /**
   * Stop watching the config file.
   */
  stopWatching() {
    if (this._watcher) {
      this._watcher.close()
      this._watcher = null
    }
    clearTimeout(this._debounceTimer)
  }

  /**
   * Force a manual reload of the config from disk.
   * Returns { ok, agents?, errors? }
   */
  reload() {
    const previousAgents = this.getAllAgents()
    try {
      this._load()
      if (this._lastValidationErrors) {
        return { ok: false, errors: this._lastValidationErrors }
      }
      return { ok: true, agents: this.getAllAgents().length }
    } catch (err) {
      // Restore previous state
      this.agents.clear()
      for (const agent of previousAgents) {
        this.agents.set(agent.id, agent)
      }
      return { ok: false, errors: err.message }
    }
  }

  /**
   * Get the last validation errors (if any) from load or reload.
   */
  getLastValidationErrors() {
    return this._lastValidationErrors
  }

  getAgent(id) {
    return this.agents.get(id) || null
  }

  getAllAgents() {
    return Array.from(this.agents.values())
  }

  addAgent(config) {
    const result = validateAgent(config)
    if (!result.ok) {
      const errorSummary = result.errors.map(e => `${e.path}: ${e.message}`).join("; ")
      throw new ValidationError(`Invalid agent: ${errorSummary}`)
    }
    if (this.agents.has(config.id)) {
      throw new ConflictError(`Agent "${config.id}" already exists`)
    }
    const agent = {
      id: result.data.id,
      name: result.data.name,
      personality: result.data.personality || "",
      voice: result.data.voice || this.defaults.voice,
      avatar: result.data.avatar || "",
      theme: result.data.theme || {
        primary: "#818cf8",
        gradient: ["#667eea", "#764ba2"],
        background: ["#1a1a2e", "#16213e"]
      }
    }
    this.agents.set(agent.id, agent)
    logger.info(`[AgentRegistry] Added agent: ${agent.id} (${agent.name})`)
    return agent
  }

  updateAgent(id, updates) {
    const agent = this.agents.get(id)
    if (!agent) {
      throw new NotFoundError(`Agent "${id}" not found`)
    }
    // Don't allow changing the id
    const { id: _ignoreId, ...safeUpdates } = updates
    const updated = { ...agent, ...safeUpdates }
    this.agents.set(id, updated)
    logger.info(`[AgentRegistry] Updated agent: ${id}`)
    return updated
  }

  removeAgent(id) {
    if (!this.agents.has(id)) {
      throw new NotFoundError(`Agent "${id}" not found`)
    }
    this.agents.delete(id)
    logger.info(`[AgentRegistry] Removed agent: ${id}`)
  }

  getSystemPrompt(id) {
    const agent = this.agents.get(id)
    if (!agent) return null
    return `${this.basePrompt}\n${agent.personality || ""}`
  }

  getVoice(id) {
    const agent = this.agents.get(id)
    if (!agent) return this.defaults.voice
    return agent.voice || this.defaults.voice
  }

  // Returns public-safe agent info (no system prompt)
  getPublicAgent(id) {
    const agent = this.agents.get(id)
    if (!agent) return null
    return {
      id: agent.id,
      name: agent.name,
      voice: agent.voice,
      avatar: agent.avatar,
      theme: agent.theme
    }
  }

  getPublicAgents() {
    return this.getAllAgents().map(a => ({
      id: a.id,
      name: a.name,
      voice: a.voice,
      avatar: a.avatar,
      theme: a.theme
    }))
  }

  // Build prompts/voices maps for providers that expect them keyed by agentId
  getPromptsMap() {
    const map = {}
    for (const [id, agent] of this.agents) {
      map[id] = this.getSystemPrompt(id)
    }
    return map
  }

  getVoicesMap() {
    const map = {}
    for (const [id, agent] of this.agents) {
      map[id] = agent.voice || this.defaults.voice
    }
    return map
  }
}

module.exports = AgentRegistry


