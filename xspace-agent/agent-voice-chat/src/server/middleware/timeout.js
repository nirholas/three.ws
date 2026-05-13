// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { logger } = require("../logger")

const DEFAULT_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS) || 30_000
const STREAMING_TIMEOUT_MS = parseInt(process.env.STREAM_TIMEOUT_MS) || 120_000

/**
 * Request timeout middleware.
 * Aborts the request if it exceeds the configured timeout.
 *
 * @param {object} [options]
 * @param {number} [options.timeout] - Timeout in ms (default: 30s regular, 120s streaming)
 */
function requestTimeout(options = {}) {
  return (req, res, next) => {
    const isStreaming = req.headers.accept === "text/event-stream"
    const timeout = options.timeout || (isStreaming ? STREAMING_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)

    const timer = setTimeout(() => {
      if (res.headersSent) {
        // For streaming responses that already started, end the stream
        logger.warn({ method: req.method, url: req.originalUrl, timeoutMs: timeout }, "Request timeout (headers already sent)")
        res.end()
        return
      }

      logger.warn({ method: req.method, url: req.originalUrl, timeoutMs: timeout }, "Request timeout")
      res.status(504).json({
        ok: false,
        error: { code: "REQUEST_TIMEOUT", message: `Request timed out after ${timeout}ms` }
      })
    }, timeout)

    // Clean up timer when response finishes
    res.on("close", () => clearTimeout(timer))
    res.on("finish", () => clearTimeout(timer))

    next()
  }
}

module.exports = { requestTimeout, DEFAULT_TIMEOUT_MS, STREAMING_TIMEOUT_MS }


