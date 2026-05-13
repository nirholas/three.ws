// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { randomUUID } = require("crypto")

/**
 * Middleware: assign a unique request ID to every HTTP request.
 * - Respects an incoming X-Request-Id header (for proxy/tracing chains).
 * - Echoes the ID back in the X-Request-Id response header.
 * - Exposes it as req.id so all downstream handlers and loggers can use it.
 */
function requestId(req, res, next) {
  req.id = req.headers["x-request-id"] || randomUUID()
  res.setHeader("X-Request-Id", req.id)
  next()
}

module.exports = { requestId }


