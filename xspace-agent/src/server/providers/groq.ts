// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import axios from "axios"
import type { Provider } from "../types"

const GROQ_API_KEY = process.env.GROQ_API_KEY
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
const MAX_HISTORY = 20

const history: Record<number, Array<{ role: string; content: string }>> = { 0: [], 1: [] }

function addToHistory(agentId: number, role: string, content: string): void {
  if (!history[agentId]) history[agentId] = []
  history[agentId].push({ role, content })
  if (history[agentId].length > MAX_HISTORY) {
    history[agentId] = history[agentId].slice(-MAX_HISTORY)
  }
}

async function* streamResponse(
  agentId: number,
  userText: string,
  systemPrompt: string,
): AsyncGenerator<string, void, unknown> {
  addToHistory(agentId, "user", userText)

  const messages = [{ role: "system", content: systemPrompt }, ...history[agentId]]

  const response = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    { model: MODEL, messages, max_tokens: 300, stream: true },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      responseType: "stream",
    },
  )

  let fullResponse = ""

  for await (const chunk of response.data) {
    const lines = chunk
      .toString()
      .split("\n")
      .filter((l: string) => l.startsWith("data: "))
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
      } catch {
        // skip malformed chunks
      }
    }
  }

  addToHistory(agentId, "assistant", fullResponse)
}

function clearHistory(agentId: number): void {
  history[agentId] = []
}

const provider: Provider = { type: "socket", streamResponse, clearHistory }
module.exports = provider


