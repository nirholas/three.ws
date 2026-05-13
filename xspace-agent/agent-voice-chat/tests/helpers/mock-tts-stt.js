// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

/**
 * Creates a mock TTS provider that returns instant results.
 */
function createMockTTS(opts = {}) {
  const { shouldFail = false, provider = "mock", format = "mp3" } = opts

  return {
    TTS_PROVIDER: provider,
    TTS_FORMAT: format,
    voiceMap: { 0: "onyx", 1: "nova" },
    async synthesize(text, agentId) {
      if (shouldFail) throw new Error("Mock TTS error")
      // Return a small buffer that represents mock audio
      return Buffer.from(`mock-audio:${text.slice(0, 20)}`)
    }
  }
}

/**
 * Creates a mock TTS that returns null (browser fallback).
 */
function createBrowserFallbackTTS() {
  return {
    TTS_PROVIDER: "browser",
    TTS_FORMAT: "mp3",
    voiceMap: {},
    async synthesize() {
      return null
    }
  }
}

/**
 * Creates a mock Chatterbox TTS provider (self-hosted, returns wav).
 */
function createMockChatterboxTTS(opts = {}) {
  const { shouldFail = false } = opts

  return {
    TTS_PROVIDER: "chatterbox",
    TTS_FORMAT: "wav",
    voiceMap: { 0: "ref-agent-0", 1: "ref-agent-1" },
    async synthesize(text, agentId) {
      if (shouldFail) throw new Error("Mock Chatterbox error: server not reachable")
      return Buffer.from(`mock-chatterbox-wav:${text.slice(0, 20)}`)
    }
  }
}

/**
 * Creates a mock Piper TTS provider (self-hosted, returns wav).
 */
function createMockPiperTTS(opts = {}) {
  const { shouldFail = false } = opts

  return {
    TTS_PROVIDER: "piper",
    TTS_FORMAT: "wav",
    voiceMap: { 0: "en_US-lessac-medium", 1: "en_US-amy-medium" },
    async synthesize(text, agentId) {
      if (shouldFail) throw new Error("Mock Piper error: server not reachable")
      return Buffer.from(`mock-piper-wav:${text.slice(0, 20)}`)
    }
  }
}

/**
 * Creates a mock STT provider that returns instant results.
 */
function createMockSTT(opts = {}) {
  const { text = "Hello from mock STT", shouldFail = false } = opts

  return {
    STT_PROVIDER: "mock",
    async transcribe(audioBuffer, mimeType) {
      if (shouldFail) throw new Error("Mock STT error")
      return { text }
    }
  }
}

module.exports = { createMockTTS, createBrowserFallbackTTS, createMockChatterboxTTS, createMockPiperTTS, createMockSTT }
export { createMockTTS, createBrowserFallbackTTS, createMockChatterboxTTS, createMockPiperTTS, createMockSTT }


