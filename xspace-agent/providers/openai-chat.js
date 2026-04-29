// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// DEPRECATED: Use packages/core (xspace-agent) instead.
// This file is kept for backward compatibility with server.js.
// Will be removed in v1.0.

const axios = require("axios")

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"
const MAX_HISTORY = 20

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

  const messages = [
    { role: "system", content: systemPrompt },
    ...history[agentId]
  ]

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: MODEL,
      messages,
      max_tokens: 300,
      stream: true
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      responseType: "stream"
    }
  )

  let fullResponse = ""

  for await (const chunk of response.data) {
    const lines = chunk.toString().split("\n").filter(l => l.startsWith("data: "))
    for (const line of lines) {
      const data = line.slice(6).trim()
      if (data === "[DONE]") break
      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) {
          fullResponse += delta
          yield delta
        }
      } catch (e) {
        // skip malformed chunks
      }
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


