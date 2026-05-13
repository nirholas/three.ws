// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const crypto = require("crypto")
const { logger } = require("../logger")

const API_KEY = process.env.API_KEY || null
const IS_PRODUCTION = process.env.NODE_ENV === "production"

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns false immediately (without a timing oracle) when lengths differ.
 */
function timingSafeCompare(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  if (bufA.length !== bufB.length) {
    // Perform a dummy comparison so the branch timing is consistent
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length))
    return false
  }
  return crypto.timingSafeEqual(bufA, bufB)
}

// Log warning on startup if no API_KEY is set
function logAuthStatus() {
  if (!API_KEY) {
    logger.warn("API_KEY is not set — all API endpoints are open. Set API_KEY env var to enable authentication.")
  } else {
    logger.info("API key authentication enabled")
  }
}

// Express middleware: require Bearer token on protected routes
function apiKeyAuth(req, res, next) {
  if (!API_KEY) return next()

  const ip = req.ip || req.socket?.remoteAddress
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn({ ip, method: req.method, path: req.path, reason: "missing_header" }, "Auth failed: missing or invalid Authorization header")
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid Authorization header. Use: Bearer <API_KEY>" }
    })
  }

  const token = authHeader.slice(7)
  if (!timingSafeCompare(token, API_KEY)) {
    logger.warn({ ip, method: req.method, path: req.path, reason: "invalid_key" }, "Auth failed: invalid API key")
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Invalid API key" }
    })
  }

  logger.info({ ip, method: req.method, path: req.path }, "Auth successful")
  next()
}

// Socket.IO middleware: check auth via handshake (auth object preferred)
function socketAuth(socket, next) {
  if (!API_KEY) return next()

  const ip = socket.handshake.address
  // Prefer auth object; in production, reject query-param tokens entirely
  let token = socket.handshake.auth?.token
  if (!token && socket.handshake.query?.token) {
    if (IS_PRODUCTION) {
      logger.warn(
        { socketId: socket.id, ip, reason: "query_param_rejected" },
        "Socket auth failed: query-param token rejected in production"
      )
      return next(new Error("Query parameter authentication is disabled in production. Use handshake auth object."))
    }
    logger.warn(
      { socketId: socket.id, ip },
      "DEPRECATED: Socket.IO query-param token auth leaks credentials in logs and URLs. " +
      "Use socket.handshake.auth.token instead. This will be rejected in production."
    )
    token = socket.handshake.query.token
  }

  if (!token) {
    logger.warn({ socketId: socket.id, ip, reason: "missing_token" }, "Socket auth failed: no token provided")
    return next(new Error("Authentication required. Pass token in handshake auth object."))
  }
  if (!timingSafeCompare(token, API_KEY)) {
    logger.warn({ socketId: socket.id, ip, reason: "invalid_key" }, "Socket auth failed: invalid API key")
    return next(new Error("Invalid API key"))
  }

  logger.info({ socketId: socket.id, ip }, "Socket auth successful")
  next()
}

module.exports = { apiKeyAuth, socketAuth, logAuthStatus }


