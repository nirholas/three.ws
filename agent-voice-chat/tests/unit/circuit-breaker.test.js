// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import { describe, it, expect, vi, beforeEach } from "vitest"
import { CircuitBreaker } from "../../src/server/circuit-breaker.js"

// Suppress logger output during tests
vi.mock("../../src/server/logger.js", () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

describe("CircuitBreaker", () => {
  let breaker

  beforeEach(() => {
    breaker = new CircuitBreaker("test-provider", { failureThreshold: 3, resetTimeout: 100 })
  })

  describe("basic state transitions", () => {
    it("starts in CLOSED state", () => {
      const state = breaker.getState()
      expect(state.state).toBe("CLOSED")
      expect(state.failureCount).toBe(0)
      expect(state.name).toBe("test-provider")
    })

    it("stays CLOSED on successful calls", async () => {
      await breaker.execute(() => Promise.resolve("ok"))
      expect(breaker.getState().state).toBe("CLOSED")
      expect(breaker.getState().failureCount).toBe(0)
    })

    it("increments failureCount on failed calls", async () => {
      await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow("fail")
      expect(breaker.getState().failureCount).toBe(1)
      expect(breaker.getState().state).toBe("CLOSED")
    })

    it("transitions to OPEN after reaching failure threshold", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow()
      }
      expect(breaker.getState().state).toBe("OPEN")
    })

    it("rejects calls immediately when OPEN", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow()
      }
      await expect(breaker.execute(() => Promise.resolve("ok"))).rejects.toThrow(/OPEN/)
    })

    it("transitions to HALF_OPEN after resetTimeout", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow()
      }
      // Wait for reset timeout
      await new Promise(r => setTimeout(r, 150))
      // Next call should be allowed (HALF_OPEN)
      await breaker.execute(() => Promise.resolve("recovered"))
      expect(breaker.getState().state).toBe("CLOSED")
    })

    it("returns to OPEN if HALF_OPEN trial fails", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow()
      }
      await new Promise(r => setTimeout(r, 150))
      // Trial call fails
      await expect(breaker.execute(() => Promise.reject(new Error("still broken")))).rejects.toThrow()
      expect(breaker.getState().state).toBe("OPEN")
    })
  })

  describe("EventEmitter", () => {
    it("emits state-change on CLOSED → OPEN", async () => {
      const events = []
      breaker.on("state-change", (e) => events.push(e))

      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow()
      }

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        from: "CLOSED",
        to: "OPEN",
        provider: "test-provider"
      })
    })

    it("emits state-change on OPEN → HALF_OPEN → CLOSED", async () => {
      const events = []
      breaker.on("state-change", (e) => events.push(e))

      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow()
      }

      await new Promise(r => setTimeout(r, 150))
      await breaker.execute(() => Promise.resolve("ok"))

      expect(events).toHaveLength(3)
      expect(events[0]).toEqual({ from: "CLOSED", to: "OPEN", provider: "test-provider" })
      expect(events[1]).toEqual({ from: "OPEN", to: "HALF_OPEN", provider: "test-provider" })
      expect(events[2]).toEqual({ from: "HALF_OPEN", to: "CLOSED", provider: "test-provider" })
    })

    it("does not emit when state stays the same", async () => {
      const events = []
      breaker.on("state-change", (e) => events.push(e))

      // Successful calls keep state CLOSED — no event
      await breaker.execute(() => Promise.resolve("ok"))
      await breaker.execute(() => Promise.resolve("ok"))

      expect(events).toHaveLength(0)
    })
  })

  describe("metrics tracking", () => {
    it("tracks success rate", async () => {
      await breaker.execute(() => Promise.resolve("ok"))
      await breaker.execute(() => Promise.resolve("ok"))
      await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow()

      const state = breaker.getState()
      expect(state.successRate).toBeCloseTo(0.667, 2)
    })

    it("tracks lastSuccess timestamp", async () => {
      expect(breaker.getState().lastSuccess).toBeNull()
      await breaker.execute(() => Promise.resolve("ok"))
      expect(breaker.getState().lastSuccess).not.toBeNull()
    })

    it("tracks lastFailure timestamp", async () => {
      expect(breaker.getState().lastFailure).toBeNull()
      await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow()
      expect(breaker.getState().lastFailure).not.toBeNull()
    })

    it("tracks average latency", async () => {
      await breaker.execute(() => new Promise(r => setTimeout(() => r("ok"), 10)))
      const state = breaker.getState()
      expect(state.avgLatencyMs).toBeGreaterThanOrEqual(5)
    })

    it("returns ISO timestamps in getState", async () => {
      await breaker.execute(() => Promise.resolve("ok"))
      const state = breaker.getState()
      // Should be valid ISO string
      expect(new Date(state.lastSuccess).toISOString()).toBe(state.lastSuccess)
    })

    it("defaults to 1.0 successRate with no requests", () => {
      expect(breaker.getState().successRate).toBe(1.0)
    })
  })
})
