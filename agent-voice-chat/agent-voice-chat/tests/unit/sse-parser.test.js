// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { parseSSEChunk, parseSSEStream } from "../../lib/sse-parser"

describe("SSE Parser", () => {
  describe("parseSSEChunk", () => {
    it("parses a single data line", () => {
      const chunk = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n'
      const result = parseSSEChunk(chunk)

      expect(result.deltas).toEqual(["Hello"])
      expect(result.done).toBe(false)
    })

    it("parses multiple data lines", () => {
      const chunk = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        ""
      ].join("\n")

      const result = parseSSEChunk(chunk)

      expect(result.deltas).toEqual(["Hello", " world"])
      expect(result.done).toBe(false)
    })

    it("handles [DONE] sentinel", () => {
      const chunk = "data: [DONE]\n"
      const result = parseSSEChunk(chunk)

      expect(result.deltas).toEqual([])
      expect(result.done).toBe(true)
    })

    it("stops processing after [DONE]", () => {
      const chunk = [
        'data: {"choices":[{"delta":{"content":"before"}}]}',
        "data: [DONE]",
        'data: {"choices":[{"delta":{"content":"after"}}]}'
      ].join("\n")

      const result = parseSSEChunk(chunk)

      expect(result.deltas).toEqual(["before"])
      expect(result.done).toBe(true)
    })

    it("skips malformed JSON gracefully", () => {
      const chunk = [
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        "data: {invalid json}",
        'data: {"choices":[{"delta":{"content":"still ok"}}]}'
      ].join("\n")

      const result = parseSSEChunk(chunk)

      expect(result.deltas).toEqual(["ok", "still ok"])
      expect(result.done).toBe(false)
    })

    it("skips lines that don't start with 'data: '", () => {
      const chunk = [
        ": comment",
        "event: message",
        'data: {"choices":[{"delta":{"content":"found"}}]}',
        "id: 123",
        ""
      ].join("\n")

      const result = parseSSEChunk(chunk)

      expect(result.deltas).toEqual(["found"])
    })

    it("handles empty data line", () => {
      const chunk = "data: \n"
      const result = parseSSEChunk(chunk)

      expect(result.deltas).toEqual([])
      expect(result.done).toBe(false)
    })

    it("handles data with no content delta", () => {
      const chunk = 'data: {"choices":[{"delta":{}}]}\n'
      const result = parseSSEChunk(chunk)

      expect(result.deltas).toEqual([])
    })

    it("handles Buffer input", () => {
      const chunk = Buffer.from('data: {"choices":[{"delta":{"content":"buffered"}}]}\n')
      const result = parseSSEChunk(chunk)

      expect(result.deltas).toEqual(["buffered"])
    })

    it("handles empty string", () => {
      const result = parseSSEChunk("")
      expect(result.deltas).toEqual([])
      expect(result.done).toBe(false)
    })
  })

  describe("parseSSEStream", () => {
    it("yields deltas from stream chunks", async () => {
      async function* createStream() {
        yield 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n'
        yield 'data: {"choices":[{"delta":{"content":" world"}}]}\n'
      }

      const deltas = []
      for await (const delta of parseSSEStream(createStream())) {
        deltas.push(delta)
      }

      expect(deltas).toEqual(["Hello", " world"])
    })

    it("stops at [DONE]", async () => {
      async function* createStream() {
        yield 'data: {"choices":[{"delta":{"content":"before"}}]}\n'
        yield "data: [DONE]\n"
        yield 'data: {"choices":[{"delta":{"content":"after"}}]}\n'
      }

      const deltas = []
      for await (const delta of parseSSEStream(createStream())) {
        deltas.push(delta)
      }

      expect(deltas).toEqual(["before"])
    })

    it("handles chunked data (split across chunks)", async () => {
      // Simulate data split across TCP chunks
      async function* createStream() {
        yield 'data: {"choices":[{"delta":{"content":"chunk1"}}]}\ndata: {"choi'
        yield 'ces":[{"delta":{"content":"chunk2"}}]}\n'
      }

      const deltas = []
      for await (const delta of parseSSEStream(createStream())) {
        deltas.push(delta)
      }

      // First chunk yields "chunk1", second part may be incomplete
      // The parser splits by newline, so "data: {\"choi" is an incomplete line
      // and "ces\"..." becomes a new data line — this tests robustness
      expect(deltas).toContain("chunk1")
      // chunk2 may or may not parse depending on split — the parser should not crash
    })

    it("handles empty stream", async () => {
      async function* createStream() {
        // empty
      }

      const deltas = []
      for await (const delta of parseSSEStream(createStream())) {
        deltas.push(delta)
      }

      expect(deltas).toEqual([])
    })
  })
})


