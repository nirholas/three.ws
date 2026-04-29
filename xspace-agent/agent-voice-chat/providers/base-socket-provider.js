// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const axios = require("axios")
const { ConversationHistory } = require("./conversation-history")
const { parseSSEStream } = require("./sse-parser")

/**
 * Base class for socket-based LLM providers that use OpenAI-compatible
 * chat completions endpoints with SSE streaming.
 *
 * Subclasses must implement:
 *   - static name (string)
 *   - static requiredEnvVars (string[])
 *   - getApiConfig() → { url, headers, model }
 *
 * Optionally override:
 *   - formatMessages(history, systemPrompt) → messages array
 *   - extractDelta(parsed) → string|null
 */
class BaseSocketProvider {
  constructor() {
    this.type = "socket"
    this.history = new ConversationHistory()
  }

  /** Return { url, headers, model } for the completions endpoint */
  getApiConfig() {
    throw new Error("getApiConfig() must be implemented by subclass")
  }

  /** Format messages for the API. Default: system message + history */
  formatMessages(history, systemPrompt) {
    return [
      { role: "system", content: systemPrompt },
      ...history
    ]
  }

  /** Extract text delta from a parsed SSE chunk. Default: OpenAI format */
  extractDelta(parsed) {
    return parsed.choices?.[0]?.delta?.content || null
  }

  async *streamResponse(agentId, userText, systemPrompt, roomId) {
    this.history.add(roomId, agentId, "user", userText)

    const { url, headers, model } = this.getApiConfig()
    const messages = this.formatMessages(this.history.get(roomId, agentId), systemPrompt)

    const response = await axios.post(
      url,
      { model, messages, max_tokens: 300, stream: true },
      { headers, responseType: "stream" }
    )

    let fullResponse = ""

    for await (const parsed of parseSSEStream(response.data)) {
      const delta = this.extractDelta(parsed)
      if (delta) {
        fullResponse += delta
        yield delta
      }
    }

    this.history.add(roomId, agentId, "assistant", fullResponse)
  }

  clearHistory(agentId, roomId) {
    this.history.clear(agentId, roomId)
  }

  clearRoomHistory(roomId) {
    this.history.clearRoom(roomId)
  }
}

module.exports = { BaseSocketProvider }


