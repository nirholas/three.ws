// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

/**
 * On-demand provider health validation.
 *
 * Runs real connectivity checks against configured providers
 * and returns results combined with circuit breaker state.
 */
const { logger } = require("../logger")

// ─── Individual provider checks ─────────────────────────────────────────────

async function checkOpenAI() {
  const key = process.env.OPENAI_API_KEY
  if (!key) return { status: "unconfigured", latencyMs: 0 }
  const start = Date.now()
  try {
    const res = await fetch("https://api.openai.com/v1/models?limit=1", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000)
    })
    const latencyMs = Date.now() - start
    return { status: res.ok ? "connected" : "error", latencyMs }
  } catch (err) {
    return { status: "error", latencyMs: Date.now() - start, error: err.message }
  }
}

async function checkAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { status: "unconfigured", latencyMs: 0 }
  return { status: /^sk-ant-/.test(key) ? "available" : "error", latencyMs: 0 }
}

async function checkGroq() {
  const key = process.env.GROQ_API_KEY
  if (!key) return { status: "unconfigured", latencyMs: 0 }
  const start = Date.now()
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000)
    })
    const latencyMs = Date.now() - start
    return { status: res.ok ? "connected" : "error", latencyMs }
  } catch (err) {
    return { status: "error", latencyMs: Date.now() - start, error: err.message }
  }
}

const PROVIDER_CHECKS = {
  openai: checkOpenAI,
  "openai-chat": checkOpenAI,
  claude: checkAnthropic,
  groq: checkGroq
}

/**
 * Run health checks for all configured providers and merge with circuit breaker state.
 *
 * @param {object} breakers - { llm, stt, tts } circuit breaker instances
 * @returns {object} { llm, stt, tts } with connectivity + breaker state
 */
async function checkAllProviders(breakers) {
  const aiProvider = process.env.AI_PROVIDER || "openai"
  const sttProvider = process.env.STT_PROVIDER || "groq"
  const ttsProvider = process.env.TTS_PROVIDER || "openai"

  const [llmResult, sttResult, ttsResult] = await Promise.allSettled([
    runProviderCheck("llm", aiProvider, breakers?.llm),
    runProviderCheck("stt", sttProvider, breakers?.stt),
    runProviderCheck("tts", ttsProvider, breakers?.tts)
  ])

  return {
    llm: extractResult(llmResult),
    stt: extractResult(sttResult),
    tts: extractResult(ttsResult)
  }
}

async function runProviderCheck(role, providerName, breaker) {
  const checkFn = providerName === "browser"
    ? async () => ({ status: "available", latencyMs: 0 })
    : PROVIDER_CHECKS[providerName]

  let connectivity = { status: "unknown", latencyMs: 0 }
  if (checkFn) {
    try {
      connectivity = await checkFn()
    } catch (err) {
      connectivity = { status: "error", latencyMs: 0, error: err.message }
    }
  }

  const breakerState = breaker ? breaker.getState() : null

  logger.debug({ role, providerName, connectivity: connectivity.status }, "Provider check completed")

  return {
    provider: providerName,
    connectivity: connectivity.status,
    connectivityLatencyMs: connectivity.latencyMs,
    ...(connectivity.error && { connectivityError: connectivity.error }),
    circuitBreaker: breakerState ? breakerState.state : "N/A",
    failureCount: breakerState ? breakerState.failureCount : 0,
    lastSuccess: breakerState ? breakerState.lastSuccess : null,
    lastFailure: breakerState ? breakerState.lastFailure : null,
    successRate: breakerState ? breakerState.successRate : 1.0,
    avgLatencyMs: breakerState ? breakerState.avgLatencyMs : 0
  }
}

function extractResult(settled) {
  if (settled.status === "fulfilled") return settled.value
  return { provider: "unknown", connectivity: "error", circuitBreaker: "N/A", error: settled.reason?.message }
}

module.exports = { checkAllProviders, PROVIDER_CHECKS }
