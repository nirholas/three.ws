// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

/**
 * Async generator that parses an SSE stream from a fetch/axios response.
 * Yields parsed JSON data objects from each `data: {...}` line.
 * Stops on `data: [DONE]`.
 */
async function* parseSSEStream(responseStream) {
  for await (const chunk of responseStream) {
    const lines = chunk.toString().split("\n").filter(l => l.startsWith("data: "))
    for (const line of lines) {
      const data = line.slice(6).trim()
      if (data === "[DONE]") return
      try {
        yield JSON.parse(data)
      } catch (e) {
        // skip malformed chunks
      }
    }
  }
}

module.exports = { parseSSEStream }


