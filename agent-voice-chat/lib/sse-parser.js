// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

/**
 * Parse a single SSE chunk (string or Buffer) and yield content deltas.
 * Returns { deltas: string[], done: boolean }
 */
function parseSSEChunk(chunk) {
  const text = typeof chunk === "string" ? chunk : chunk.toString()
  const lines = text.split("\n").filter(l => l.startsWith("data: "))
  const deltas = []
  let done = false

  for (const line of lines) {
    const data = line.slice(6).trim()
    if (data === "[DONE]") {
      done = true
      break
    }
    try {
      const parsed = JSON.parse(data)
      const delta = parsed.choices?.[0]?.delta?.content
      if (delta) {
        deltas.push(delta)
      }
    } catch (e) {
      // skip malformed JSON
    }
  }

  return { deltas, done }
}

/**
 * Async generator that consumes an SSE stream and yields content deltas.
 */
async function* parseSSEStream(stream) {
  for await (const chunk of stream) {
    const { deltas, done } = parseSSEChunk(chunk)
    for (const delta of deltas) {
      yield delta
    }
    if (done) return
  }
}

module.exports = { parseSSEChunk, parseSSEStream }
