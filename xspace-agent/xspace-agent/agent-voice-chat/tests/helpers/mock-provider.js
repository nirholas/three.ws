// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

/**
 * Creates a mock LLM provider that returns deterministic responses.
 */
function createMockProvider(opts = {}) {
  const {
    type = "socket",
    responses = {},
    defaultResponse = "Hello, this is a mock response.",
    delay = 0
  } = opts

  const history = {}

  async function* streamResponse(agentId, userText, systemPrompt, roomId) {
    const response = responses[agentId] || defaultResponse
    const words = response.split(" ")

    if (!history[agentId]) history[agentId] = []
    history[agentId].push({ role: "user", content: userText })

    for (const word of words) {
      if (delay > 0) await new Promise(r => setTimeout(r, delay))
      yield word + " "
    }

    history[agentId].push({ role: "assistant", content: response })
  }

  function clearHistory(agentId) {
    if (agentId !== undefined) {
      history[agentId] = []
    } else {
      for (const key of Object.keys(history)) delete history[key]
    }
  }

  async function createSession(agentId, prompts, voices) {
    return {
      client_secret: { value: "mock-ephemeral-key" },
      model: "mock-model",
      voice: voices?.[agentId] || "alloy"
    }
  }

  return {
    type,
    streamResponse,
    clearHistory,
    createSession,
    _history: history
  }
}

/**
 * Creates a mock provider that throws errors on streamResponse.
 */
function createErrorProvider(errorMessage = "Mock LLM error") {
  return {
    type: "socket",
    async *streamResponse() {
      throw new Error(errorMessage)
    },
    clearHistory() {},
    async createSession() {
      throw new Error(errorMessage)
    }
  }
}

module.exports = { createMockProvider, createErrorProvider }


