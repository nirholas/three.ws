// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const pino = require("pino")

const IS_PRODUCTION = process.env.NODE_ENV === "production"
const LOG_LEVEL = process.env.LOG_LEVEL || (IS_PRODUCTION ? "info" : "debug")

const logger = pino({
  level: LOG_LEVEL,
  ...(IS_PRODUCTION
    ? {
        // Structured JSON in production
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.headers['x-api-key']",
            "apiKey",
            "audio",
            "audioData",
            "token",
            "password",
            "secret",
            "*.audio",
            "*.apiKey",
            "*.authorization",
            "*.cookie",
            "*.token",
            "*.password",
            "*.secret",
            "*.['x-api-key']"
          ],
          censor: "[REDACTED]"
        }
      }
    : {
        // Pretty-print in development
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname"
          }
        }
      })
})

// Redact long user messages in production (keep first 100 chars)
function safeMessage(text) {
  if (!IS_PRODUCTION || !text) return text
  if (text.length <= 100) return text
  return text.slice(0, 100) + "...[truncated]"
}

// Express request logging middleware
function requestLogger(req, res, next) {
  const start = Date.now()
  // Attach a child logger with the request ID for downstream handlers
  req.log = logger.child({ requestId: req.id })
  res.on("finish", () => {
    const duration = Date.now() - start
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"
    req.log[level]({
      msg: "request",
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration
    })
  })
  next()
}

/**
 * Create a child logger for a Socket.IO event with a unique event ID.
 * Usage: const log = socketLogger(socket); log.info("something happened")
 */
function socketLogger(socket) {
  const { randomUUID } = require("crypto")
  return logger.child({ socketId: socket.id, eventId: randomUUID() })
}

module.exports = { logger, safeMessage, requestLogger, socketLogger, IS_PRODUCTION }


