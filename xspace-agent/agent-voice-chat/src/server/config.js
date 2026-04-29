// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

'use strict'

const { z } = require("zod")
const path = require("path")

// ── Custom validators ──────────────────────────────────────────

/** Positive integer (≥ 1) coerced from string */
const positiveInt = z.coerce.number().int().min(1)

/** Port number: 1–65535 */
const port = z.coerce.number().int().min(1).max(65535)

/** Body-size format like "1mb", "500kb", "10mb" */
const bodySizeLimit = z.string().regex(
  /^\d+\s*(b|kb|mb|gb)$/i,
  'Must be a size string like "10mb", "500kb"'
)

// ── API key format patterns (per-provider, more specific than sk-) ──

const API_KEY_PATTERNS = {
  OPENAI_API_KEY: /^sk-(?:proj-)?[A-Za-z0-9_-]{20,}$/,
  ANTHROPIC_API_KEY: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  GROQ_API_KEY: /^gsk_[A-Za-z0-9]{20,}$/,
  ELEVENLABS_API_KEY: /^[A-Za-z0-9]{20,}$/
}

/** Optional API key: empty string is treated as undefined, non-empty must match pattern */
function optionalApiKey(name) {
  const pattern = API_KEY_PATTERNS[name]
  return z.string().optional().transform(v => v || undefined).pipe(
    z.string().regex(pattern, `${name} does not match expected format`).optional()
  )
}

// ── Provider enums ─────────────────────────────────────────────

const AI_PROVIDERS = ["openai", "openai-chat", "claude", "groq"]
const STT_PROVIDERS = ["groq", "openai"]
const TTS_PROVIDERS = ["openai", "elevenlabs", "chatterbox", "piper", "browser"]
const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"]

// ── Required keys per provider ─────────────────────────────────

const PROVIDER_REQUIRED_KEYS = {
  openai: ["OPENAI_API_KEY"],
  "openai-chat": ["OPENAI_API_KEY"],
  claude: ["ANTHROPIC_API_KEY"],
  groq: ["GROQ_API_KEY"]
}

const STT_REQUIRED_KEYS = {
  groq: ["GROQ_API_KEY"],
  openai: ["OPENAI_API_KEY"]
}

const TTS_REQUIRED_KEYS = {
  openai: ["OPENAI_API_KEY"],
  elevenlabs: ["ELEVENLABS_API_KEY"]
}

// ── Schema ─────────────────────────────────────────────────────

const envSchema = z.object({
  // AI Provider
  AI_PROVIDER: z.enum(AI_PROVIDERS).default("openai"),

  // API Keys (validated per-provider in superRefine)
  OPENAI_API_KEY: optionalApiKey("OPENAI_API_KEY"),
  ANTHROPIC_API_KEY: optionalApiKey("ANTHROPIC_API_KEY"),
  GROQ_API_KEY: optionalApiKey("GROQ_API_KEY"),
  ELEVENLABS_API_KEY: optionalApiKey("ELEVENLABS_API_KEY"),

  // STT / TTS
  STT_PROVIDER: z.enum(STT_PROVIDERS).default("groq"),
  TTS_PROVIDER: z.enum(TTS_PROVIDERS).default("browser"),

  // Model overrides (must be non-empty when set)
  OPENAI_MODEL: z.string().min(1, "OPENAI_MODEL must be non-empty if set").optional(),
  OPENAI_REALTIME_MODEL: z.string().min(1).optional(),
  CLAUDE_MODEL: z.string().min(1, "CLAUDE_MODEL must be non-empty if set").optional(),
  GROQ_MODEL: z.string().min(1, "GROQ_MODEL must be non-empty if set").optional(),

  // TTS voice / URL configuration
  ELEVENLABS_VOICE_0: z.string().optional(),
  ELEVENLABS_VOICE_1: z.string().optional(),
  CHATTERBOX_API_URL: z.string().url().default("http://localhost:8150"),
  CHATTERBOX_VOICE_REF_0: z.string().optional(),
  CHATTERBOX_VOICE_REF_1: z.string().optional(),
  PIPER_API_URL: z.string().url().default("http://localhost:5000"),
  PIPER_VOICE_0: z.string().default("en_US-lessac-medium"),
  PIPER_VOICE_1: z.string().default("en_US-amy-medium"),

  // Server
  PORT: port.default(3000),
  PROJECT_NAME: z.string().default("AI Agents"),
  INPUT_CHAT: z.string().default("true").transform(v => v !== "false"),
  AVATAR_URL_1: z.string().default(""),
  AVATAR_URL_2: z.string().default(""),
  MAX_ROOMS: positiveInt.default(100),
  MAX_MESSAGES_PER_ROOM: positiveInt.default(500),
  SHUTDOWN_TIMEOUT_MS: positiveInt.default(10000),
  BODY_SIZE_LIMIT: bodySizeLimit.default("10mb"),

  // Socket.IO
  SOCKET_PING_TIMEOUT: positiveInt.default(60000),
  SOCKET_PING_INTERVAL: positiveInt.default(25000),

  // Memory System
  MEMORY_ENABLED: z.string().default("true").transform(v => v !== "false"),
  MEMORY_STORAGE_PATH: z.string().default("./memory"),
  MEMORY_MAX_MEMORIES: positiveInt.default(1000),

  // Knowledge Base
  KNOWLEDGE_DIRECTORY: z.string().default("./knowledge"),
  KNOWLEDGE_INDEX_PATH: z.string().default("./knowledge/index.json"),
  KNOWLEDGE_CHUNK_SIZE: positiveInt.default(500),
  KNOWLEDGE_CHUNK_OVERLAP: positiveInt.default(50),
  KNOWLEDGE_MAX_CHUNKS: positiveInt.default(3),

  // Concurrency / Timeouts
  MAX_CONCURRENT_EXTRACTIONS: positiveInt.default(3),
  MAX_CONCURRENT_STT: positiveInt.default(3),
  AUDIO_QUEUE_MAX: positiveInt.default(20),
  IN_FLIGHT_MAX_TTL_MS: positiveInt.default(300000),
  STREAM_TIMEOUT_MS: positiveInt.default(120000),
  REQUEST_TIMEOUT_MS: positiveInt.default(30000),

  // Rate Limiting (requests per minute per IP)
  RATE_LIMIT_MESSAGE: positiveInt.default(20),
  RATE_LIMIT_SESSION: positiveInt.default(5),
  RATE_LIMIT_GENERAL: positiveInt.default(100),

  // Security
  API_KEY: z.string().optional().transform(v => v || undefined),
  CORS_ORIGINS: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  X_FRAME_OPTIONS: z.enum(["SAMEORIGIN", "DENY"]).default("SAMEORIGIN"),

  // Logging
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  NODE_ENV: z.string().default("development"),

  // Personalities
  MAX_PERSONALITIES: positiveInt.default(50)
}).superRefine((data, ctx) => {
  // ── AI provider requires its API key ──
  const aiKeys = PROVIDER_REQUIRED_KEYS[data.AI_PROVIDER] || []
  for (const key of aiKeys) {
    if (!data[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${key} is required when AI_PROVIDER="${data.AI_PROVIDER}"`,
        path: [key],
        fatal: true
      })
    }
  }

  // ── STT provider requires its API key (error, not warning — server cannot function) ──
  const sttKeys = STT_REQUIRED_KEYS[data.STT_PROVIDER] || []
  for (const key of sttKeys) {
    if (!data[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${key} is required when STT_PROVIDER="${data.STT_PROVIDER}" — STT will not function`,
        path: [key],
        fatal: true
      })
    }
  }

  // ── TTS provider requires its API key (error for paid providers) ──
  const ttsKeys = TTS_REQUIRED_KEYS[data.TTS_PROVIDER] || []
  for (const key of ttsKeys) {
    if (!data[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${key} is required when TTS_PROVIDER="${data.TTS_PROVIDER}" — TTS will not function`,
        path: [key],
        fatal: true
      })
    }
  }
})

// ── Sensitive keys (never expose via API) ──────────────────────

const SENSITIVE_KEYS = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "ELEVENLABS_API_KEY",
  "API_KEY"
])

/**
 * Return a redacted copy of config safe for API responses.
 * Sensitive values are replaced with "***" (or undefined if unset).
 */
function redactConfig(config) {
  const safe = {}
  for (const [key, value] of Object.entries(config)) {
    if (SENSITIVE_KEYS.has(key)) {
      safe[key] = value ? "***" : undefined
    } else {
      safe[key] = value
    }
  }
  return safe
}

/**
 * Validate current config and return an array of health issues.
 * Returns [] when everything is healthy.
 */
function validateConfigHealth(config) {
  const issues = []

  // Check API key presence for active providers
  const aiKeys = PROVIDER_REQUIRED_KEYS[config.AI_PROVIDER] || []
  for (const key of aiKeys) {
    if (!config[key]) issues.push({ level: "error", key, message: `Missing ${key} for AI_PROVIDER="${config.AI_PROVIDER}"` })
  }

  const sttKeys = STT_REQUIRED_KEYS[config.STT_PROVIDER] || []
  for (const key of sttKeys) {
    if (!config[key]) issues.push({ level: "error", key, message: `Missing ${key} for STT_PROVIDER="${config.STT_PROVIDER}"` })
  }

  const ttsKeys = TTS_REQUIRED_KEYS[config.TTS_PROVIDER] || []
  for (const key of ttsKeys) {
    if (!config[key]) issues.push({ level: "error", key, message: `Missing ${key} for TTS_PROVIDER="${config.TTS_PROVIDER}"` })
  }

  // Warnings for optional but recommended settings
  if (!config.API_KEY) {
    issues.push({ level: "warning", key: "API_KEY", message: "API endpoints are unprotected — set API_KEY to require authentication" })
  }
  if (config.NODE_ENV === "production" && !config.CORS_ORIGINS) {
    issues.push({ level: "warning", key: "CORS_ORIGINS", message: "Running in production without CORS_ORIGINS — defaulting to same-origin only" })
  }

  return issues
}

// ── Parse and export ───────────────────────────────────────────

let _config = null

/**
 * Parse process.env through the schema. Throws on invalid critical config.
 * Call once at startup (before importing other modules that need config).
 */
function loadConfig() {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const messages = result.error.issues.map(issue => {
      const path = issue.path.join(".")
      return `  ${path}: ${issue.message}`
    })
    const msg = "Environment validation failed:\n" + messages.join("\n")
    // We throw instead of process.exit so tests can catch it
    throw new Error(msg)
  }

  _config = Object.freeze(result.data)
  return _config
}

/**
 * Get the current validated config. Throws if loadConfig() hasn't been called.
 */
function getConfig() {
  if (!_config) {
    throw new Error("Config not loaded — call loadConfig() at startup before accessing config")
  }
  return _config
}

module.exports = {
  loadConfig,
  getConfig,
  redactConfig,
  validateConfigHealth,
  SENSITIVE_KEYS,
  AI_PROVIDERS,
  STT_PROVIDERS,
  TTS_PROVIDERS,
  LOG_LEVELS,
  PROVIDER_REQUIRED_KEYS,
  envSchema
}


