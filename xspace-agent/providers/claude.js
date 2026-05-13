// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// DEPRECATED: Use packages/core (xspace-agent) instead.
// This file is kept for backward compatibility with server.js.
// Will be removed in v1.0.

const Anthropic = require("@anthropic-ai/sdk")

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514"
const MAX_HISTORY = 20

// Per-agent conversation history
const history = { 0: [], 1: [] }

function addToHistory(agentId, role, content) {
  if (!history[agentId]) history[agentId] = []
  history[agentId].push({ role, content })
  if (history[agentId].length > MAX_HISTORY) {
    history[agentId] = history[agentId].slice(-MAX_HISTORY)
  }
}

async function* streamResponse(agentId, userText, systemPrompt) {
  addToHistory(agentId, "user", userText)

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 300,
    system: systemPrompt,
    messages: history[agentId]
  })

  let fullResponse = ""

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      const text = event.delta.text
      fullResponse += text
      yield text
    }
  }

  addToHistory(agentId, "assistant", fullResponse)
}

function clearHistory(agentId) {
  history[agentId] = []
}

module.exports = {
  type: "socket",
  streamResponse,
  clearHistory
}


