// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

/**
 * CircuitBreaker — protects external provider calls (LLM, STT, TTS).
 *
 * States:
 *   CLOSED   — normal; failures increment failureCount
 *   OPEN     — calls are rejected immediately until resetTimeout elapses
 *   HALF_OPEN — one trial call is allowed; success → CLOSED, failure → OPEN
 */
const { EventEmitter } = require("events")
const { logger } = require("./logger")

class CircuitBreaker extends EventEmitter {
  constructor(name, options = {}) {
    super()
    this.name = name
    this.failureThreshold = options.failureThreshold || 5
    this.resetTimeout = options.resetTimeout || 30_000
    this.state = "CLOSED"
    this.failureCount = 0
    this.lastFailure = null
    this.lastSuccess = null
    this.totalRequests = 0
    this.totalSuccesses = 0
    this.totalFailures = 0
    this._latencies = [] // rolling window of recent latencies
    this._maxLatencySamples = options.maxLatencySamples || 100
  }

  async execute(fn) {
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this._transition("HALF_OPEN")
      } else {
        throw new Error(`Circuit breaker "${this.name}" is OPEN — provider calls paused`)
      }
    }

    const start = Date.now()
    this.totalRequests++

    try {
      const result = await fn()
      this._recordLatency(Date.now() - start)
      this._onSuccess()
      return result
    } catch (err) {
      this._recordLatency(Date.now() - start)
      this._onFailure()
      throw err
    }
  }

  _transition(newState) {
    const oldState = this.state
    if (oldState === newState) return
    this.state = newState
    logger.warn({
      event: "circuit_breaker.transition",
      provider: this.name,
      from: oldState,
      to: newState,
      failureCount: this.failureCount
    }, `Circuit breaker "${this.name}" transitioned: ${oldState} → ${newState}`)
    this.emit("state-change", { from: oldState, to: newState, provider: this.name })
  }

  _onSuccess() {
    this.failureCount = 0
    this.totalSuccesses++
    this.lastSuccess = Date.now()
    if (this.state !== "CLOSED") {
      this._transition("CLOSED")
    }
  }

  _onFailure() {
    this.failureCount++
    this.totalFailures++
    this.lastFailure = Date.now()
    if (this.failureCount >= this.failureThreshold) {
      this._transition("OPEN")
    }
  }

  _recordLatency(ms) {
    this._latencies.push(ms)
    if (this._latencies.length > this._maxLatencySamples) {
      this._latencies.shift()
    }
  }

  getState() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailure: this.lastFailure ? new Date(this.lastFailure).toISOString() : null,
      lastSuccess: this.lastSuccess ? new Date(this.lastSuccess).toISOString() : null,
      successRate: this.totalRequests > 0
        ? Math.round((this.totalSuccesses / this.totalRequests) * 1000) / 1000
        : 1.0,
      avgLatencyMs: this._latencies.length > 0
        ? Math.round(this._latencies.reduce((a, b) => a + b, 0) / this._latencies.length)
        : 0
    }
  }
}

// ─── Retry with exponential backoff ──────────────────────────────────────────

function isRetryable(err) {
  if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND") return true
  const status = err.status ?? err.response?.status
  if (status === 429 || (status >= 500 && status <= 503)) return true
  return false
}

async function withRetry(fn, options = {}) {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 10_000 } = options

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxRetries) throw err
      if (!isRetryable(err)) throw err

      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
      const jitter = delay * 0.1 * Math.random()
      await new Promise(r => setTimeout(r, delay + jitter))
    }
  }
}

module.exports = { CircuitBreaker, withRetry, isRetryable }


