// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { logger } = require("./logger")
const { loadConfig, validateConfigHealth } = require("./config")

/**
 * Validate environment variables at startup using the Zod config schema.
 * Exits with code 1 on fatal validation errors.
 * Logs warnings for optional but recommended settings.
 */
function validateEnv() {
  let config
  try {
    config = loadConfig()
  } catch (err) {
    // Zod validation failed — log each line then exit
    for (const line of err.message.split("\n")) {
      logger.error(line)
    }
    process.exit(1)
  }

  // Log warnings for optional but recommended settings
  const issues = validateConfigHealth(config)
  for (const issue of issues) {
    if (issue.level === "warning") {
      logger.warn(issue.message)
    }
    // Errors from validateConfigHealth are already enforced by the schema's superRefine,
    // so they won't appear here for a config that passed schema validation.
  }

  // Info messages for self-hosted providers
  if (config.TTS_PROVIDER === "chatterbox") {
    logger.info(`TTS_PROVIDER=chatterbox — ensure Chatterbox server is running at ${config.CHATTERBOX_API_URL}`)
  }
  if (config.TTS_PROVIDER === "piper") {
    logger.info(`TTS_PROVIDER=piper — ensure Piper HTTP server is running at ${config.PIPER_API_URL}`)
  }

  logger.info("Environment validation passed")
}

module.exports = { validateEnv }


