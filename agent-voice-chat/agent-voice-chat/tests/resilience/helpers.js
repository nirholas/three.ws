// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

/**
 * Chaos testing utilities for resilience tests.
 */

/**
 * Creates a provider that delays responses by a given amount.
 * @param {number} delayMs - Delay in milliseconds before each yield
 * @param {string} response - Response text to yield
 */
function createSlowProvider(delayMs, response = "Slow response") {
  return {
    type: "socket",
    async *streamResponse(agentId, userText, systemPrompt, roomId) {
      await new Promise(r => setTimeout(r, delayMs))
      yield response
    },
    clearHistory() {},
    clearRoomHistory() {}
  }
}

/**
 * Creates a provider that fails after yielding N tokens.
 * @param {number} tokensBeforeFailure - Number of tokens to yield before throwing
 * @param {string} errorMessage - Error message to throw
 */
function createPartialFailureProvider(tokensBeforeFailure, errorMessage = "Mid-stream failure") {
  return {
    type: "socket",
    async *streamResponse() {
      for (let i = 0; i < tokensBeforeFailure; i++) {
        yield `token${i} `
      }
      throw new Error(errorMessage)
    },
    clearHistory() {},
    clearRoomHistory() {}
  }
}

/**
 * Creates a provider that fails intermittently.
 * @param {number} failEveryN - Fail on every Nth call
 * @param {string} errorMessage - Error message for failures
 */
function createIntermittentProvider(failEveryN = 2, errorMessage = "Intermittent failure") {
  let callCount = 0
  return {
    type: "socket",
    async *streamResponse() {
      callCount++
      if (callCount % failEveryN === 0) {
        throw new Error(errorMessage)
      }
      yield "Success response"
    },
    clearHistory() {},
    clearRoomHistory() {},
    getCallCount() { return callCount }
  }
}

/**
 * Creates a provider that times out (never resolves).
 * @param {number} timeoutMs - How long to hang before aborting
 */
function createHangingProvider(timeoutMs = 30000) {
  return {
    type: "socket",
    async *streamResponse() {
      await new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Provider timeout")), timeoutMs)
      })
    },
    clearHistory() {},
    clearRoomHistory() {}
  }
}

/**
 * Creates a provider that returns malformed data.
 */
function createMalformedProvider() {
  return {
    type: "socket",
    async *streamResponse() {
      yield undefined
      yield null
      yield ""
      yield "\x00\xFF\xFE"
    },
    clearHistory() {},
    clearRoomHistory() {}
  }
}

/**
 * Creates an STT mock that returns configurable results.
 */
function createChaosSTT(opts = {}) {
  const { delayMs = 0, shouldTimeout = false, returnEmpty = false, shouldFail = false } = opts
  return {
    STT_PROVIDER: "chaos-mock",
    async transcribe(audioBuffer, mimeType) {
      if (shouldTimeout) {
        await new Promise((_, reject) =>
          setTimeout(() => reject(new Error("STT timeout")), delayMs || 100)
        )
      }
      if (shouldFail) throw new Error("STT provider failure")
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
      if (returnEmpty) return { text: "" }
      return { text: "Transcribed text" }
    }
  }
}

/**
 * Creates a TTS mock that returns configurable results.
 */
function createChaosTTS(opts = {}) {
  const { delayMs = 0, shouldTimeout = false, returnNull = false, shouldFail = false } = opts
  return {
    TTS_PROVIDER: "chaos-mock",
    TTS_FORMAT: "mp3",
    voiceMap: {},
    async synthesize(text, agentId) {
      if (shouldTimeout) {
        await new Promise((_, reject) =>
          setTimeout(() => reject(new Error("TTS timeout")), delayMs || 100)
        )
      }
      if (shouldFail) throw new Error("TTS provider failure")
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
      if (returnNull) return null
      return Buffer.from(`chaos-audio:${text.slice(0, 20)}`)
    }
  }
}

/**
 * Fires N concurrent requests and collects results.
 * @param {Function} requestFn - Async function to call
 * @param {number} count - Number of concurrent calls
 * @returns {Promise<{ successes: any[], errors: Error[] }>}
 */
async function fireConcurrent(requestFn, count) {
  const results = await Promise.allSettled(
    Array.from({ length: count }, (_, i) => requestFn(i))
  )
  const successes = results.filter(r => r.status === "fulfilled").map(r => r.value)
  const errors = results.filter(r => r.status === "rejected").map(r => r.reason)
  return { successes, errors }
}

/**
 * Writes corrupted data to a file path.
 * @param {string} filePath - Path to write corrupted data
 * @param {string} type - Type of corruption: "malformed_json", "binary", "empty", "truncated"
 */
function writeCorruptedFile(filePath, type = "malformed_json") {
  const fs = require("fs")
  const path = require("path")

  // Ensure directory exists
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  switch (type) {
    case "malformed_json":
      fs.writeFileSync(filePath, '{"broken": json, missing: "quotes}')
      break
    case "binary":
      fs.writeFileSync(filePath, Buffer.from([0x00, 0xFF, 0xFE, 0x89, 0x50, 0x4E, 0x47]))
      break
    case "empty":
      fs.writeFileSync(filePath, "")
      break
    case "truncated":
      fs.writeFileSync(filePath, '[{"id": "mem_1", "content": "hello", "type": "episodic"')
      break
    default:
      fs.writeFileSync(filePath, "not valid json at all")
  }
}

module.exports = {
  createSlowProvider,
  createPartialFailureProvider,
  createIntermittentProvider,
  createHangingProvider,
  createMalformedProvider,
  createChaosSTT,
  createChaosTTS,
  fireConcurrent,
  writeCorruptedFile
}


