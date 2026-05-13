// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

import Anthropic from "@anthropic-ai/sdk"
import type { Provider } from "../types"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514"
const MAX_HISTORY = 20

const history: Record<number, Array<{ role: "user" | "assistant"; content: string }>> = {
  0: [],
  1: [],
}

function addToHistory(agentId: number, role: "user" | "assistant", content: string): void {
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

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 300,
    system: systemPrompt,
    messages: history[agentId],
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

function clearHistory(agentId: number): void {
  history[agentId] = []
}

const provider: Provider = { type: "socket", streamResponse, clearHistory }
module.exports = provider


