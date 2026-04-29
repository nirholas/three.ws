// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { cosineSimilarity, findSimilar, providers, EMBEDDING_PROVIDER } from "../../lib/embeddings"

describe("embeddings", () => {
  describe("provider registry", () => {
    it("exports available providers", () => {
      expect(providers).toBeDefined()
      expect(providers.openai).toBeDefined()
      expect(providers.cohere).toBeDefined()
      expect(providers.local).toBeDefined()
    })

    it("defaults to openai provider", () => {
      expect(EMBEDDING_PROVIDER).toBe("openai")
    })

    it("local provider returns deterministic embeddings", () => {
      const result1 = providers.local(["hello world"])
      const result2 = providers.local(["hello world"])
      expect(result1).toEqual(result2)
      expect(result1[0].length).toBe(256)
    })

    it("local provider returns normalized vectors", () => {
      const result = providers.local(["test embedding normalization"])
      const vec = result[0]
      const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
      expect(magnitude).toBeCloseTo(1.0, 4)
    })

    it("local provider handles multiple texts", () => {
      const results = providers.local(["text one", "text two", "text three"])
      expect(results.length).toBe(3)
      results.forEach(vec => {
        expect(vec.length).toBe(256)
      })
    })

    it("local provider produces different embeddings for different texts", () => {
      const [a, b] = providers.local(["cats are great", "quantum physics"])
      const sim = cosineSimilarity(a, b)
      expect(sim).toBeLessThan(0.9) // different texts should not be too similar
    })
  })

  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      const v = [1, 0, 0]
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0)
    })

    it("returns 0 for orthogonal vectors", () => {
      const a = [1, 0, 0]
      const b = [0, 1, 0]
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0)
    })

    it("returns -1 for opposite vectors", () => {
      const a = [1, 0]
      const b = [-1, 0]
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0)
    })

    it("handles zero vectors gracefully", () => {
      const a = [0, 0, 0]
      const b = [1, 2, 3]
      expect(cosineSimilarity(a, b)).toBe(0)
    })

    it("returns 0 for mismatched lengths", () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
    })

    it("returns 0 for null/undefined inputs", () => {
      expect(cosineSimilarity(null, [1, 2])).toBe(0)
      expect(cosineSimilarity([1, 2], undefined)).toBe(0)
    })

    it("computes correct similarity for known vectors", () => {
      const a = [1, 2, 3]
      const b = [4, 5, 6]
      // dot = 4+10+18 = 32, |a| = sqrt(14), |b| = sqrt(77)
      const expected = 32 / (Math.sqrt(14) * Math.sqrt(77))
      expect(cosineSimilarity(a, b)).toBeCloseTo(expected)
    })
  })

  describe("findSimilar", () => {
    const items = [
      { id: "a", embedding: [1, 0, 0], content: "about dogs" },
      { id: "b", embedding: [0, 1, 0], content: "about cats" },
      { id: "c", embedding: [0.9, 0.1, 0], content: "about puppies" },
      { id: "d", embedding: [], content: "no embedding" }
    ]

    it("returns top-k most similar items", () => {
      const query = [1, 0, 0]
      const results = findSimilar(query, items, 2, 0)
      expect(results.length).toBe(2)
      expect(results[0].item.id).toBe("a") // exact match
      expect(results[0].score).toBeCloseTo(1.0)
    })

    it("filters by threshold", () => {
      const query = [1, 0, 0]
      const results = findSimilar(query, items, 10, 0.95)
      // Only "a" (1.0) and "c" (~0.99) should be above 0.95
      expect(results.every(r => r.score >= 0.95)).toBe(true)
    })

    it("excludes items with empty embeddings", () => {
      const query = [1, 0, 0]
      const results = findSimilar(query, items, 10, 0)
      const ids = results.map(r => r.item.id)
      expect(ids).not.toContain("d")
    })

    it("returns empty array for empty items", () => {
      expect(findSimilar([1, 0], [], 5)).toEqual([])
    })

    it("respects topK limit", () => {
      const query = [1, 0, 0]
      const results = findSimilar(query, items, 1, 0)
      expect(results.length).toBe(1)
    })
  })
})


