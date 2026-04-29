// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { logger } = require("../src/server/logger")

const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase()

// Provider registry — maps provider name to its class
const registry = {}

function registerProvider(ProviderClass) {
  registry[ProviderClass.name] = ProviderClass
}

// Register all built-in providers
registerProvider(require("./claude"))
registerProvider(require("./groq"))
registerProvider(require("./openai-chat"))
registerProvider(require("./openai-realtime"))

function createProvider() {
  const ProviderClass = registry[AI_PROVIDER]

  if (!ProviderClass) {
    const available = Object.keys(registry).join(", ")
    logger.error({ provider: AI_PROVIDER, available }, "Unknown provider, falling back to openai (realtime)")
    return new registry["openai"]()
  }

  // Validate required environment variables
  const missing = (ProviderClass.requiredEnvVars || []).filter(v => !process.env[v])
  if (missing.length > 0) {
    logger.error({ provider: AI_PROVIDER, missing }, "Missing required env vars for provider")
    logger.warn("Running in demo mode — LLM calls will fail until keys are configured")
  }

  return new ProviderClass()
}

module.exports = { createProvider, registerProvider, AI_PROVIDER }


