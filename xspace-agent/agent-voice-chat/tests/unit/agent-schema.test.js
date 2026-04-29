// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { validateConfig, validateAgent } from "../../lib/agent-schema"

const VALID_AGENT = {
  id: "test-agent",
  name: "Test Agent",
  personality: "A test agent personality for validation.",
  voice: "alloy",
  avatar: "/assets/test.png",
  theme: { primary: "#ff00aa" }
}

const VALID_CONFIG = {
  agents: [VALID_AGENT],
  basePrompt: "You are a test agent.",
  defaults: { voice: "alloy", maxHistoryLength: 50 }
}

describe("agent-schema", () => {
  describe("validateAgent", () => {
    it("should accept a valid agent", () => {
      const result = validateAgent(VALID_AGENT)
      expect(result.ok).toBe(true)
      expect(result.data.id).toBe("test-agent")
    })

    it("should reject agent without id", () => {
      const result = validateAgent({ name: "No ID", personality: "Some personality text." })
      expect(result.ok).toBe(false)
      expect(result.errors[0].path).toBe("id")
    })

    it("should reject agent without name", () => {
      const result = validateAgent({ id: "test", personality: "Some personality text." })
      expect(result.ok).toBe(false)
      expect(result.errors.some(e => e.path === "name")).toBe(true)
    })

    it("should reject agent ID with uppercase", () => {
      const result = validateAgent({ ...VALID_AGENT, id: "Test-Agent" })
      expect(result.ok).toBe(false)
      expect(result.errors[0].message).toMatch(/lowercase/)
    })

    it("should reject agent ID with underscores", () => {
      const result = validateAgent({ ...VALID_AGENT, id: "test_agent" })
      expect(result.ok).toBe(false)
    })

    it("should reject agent ID longer than 64 chars", () => {
      const result = validateAgent({ ...VALID_AGENT, id: "a".repeat(65) })
      expect(result.ok).toBe(false)
    })

    it("should reject agent name longer than 100 chars", () => {
      const result = validateAgent({ ...VALID_AGENT, name: "A".repeat(101) })
      expect(result.ok).toBe(false)
    })

    it("should reject personality shorter than 10 chars", () => {
      const result = validateAgent({ ...VALID_AGENT, personality: "short" })
      expect(result.ok).toBe(false)
    })

    it("should accept agent without personality (uses default)", () => {
      const { personality, ...agentWithout } = VALID_AGENT
      const result = validateAgent(agentWithout)
      expect(result.ok).toBe(true)
    })

    it("should reject invalid hex color in theme", () => {
      const result = validateAgent({
        ...VALID_AGENT,
        theme: { primary: "not-a-color" }
      })
      expect(result.ok).toBe(false)
      expect(result.errors[0].message).toMatch(/hex color/)
    })

    it("should accept valid hex color in theme", () => {
      const result = validateAgent({
        ...VALID_AGENT,
        theme: { primary: "#aaBB00" }
      })
      expect(result.ok).toBe(true)
    })
  })

  describe("validateConfig", () => {
    it("should accept a valid config", () => {
      const result = validateConfig(VALID_CONFIG)
      expect(result.ok).toBe(true)
      expect(result.data.agents).toHaveLength(1)
    })

    it("should reject config with empty agents array", () => {
      const result = validateConfig({ ...VALID_CONFIG, agents: [] })
      expect(result.ok).toBe(false)
      expect(result.errors[0].message).toMatch(/at least one/)
    })

    it("should reject config without agents", () => {
      const result = validateConfig({ basePrompt: "test" })
      expect(result.ok).toBe(false)
    })

    it("should detect duplicate agent IDs", () => {
      const result = validateConfig({
        ...VALID_CONFIG,
        agents: [VALID_AGENT, { ...VALID_AGENT }]
      })
      expect(result.ok).toBe(false)
      expect(result.errors[0].message).toMatch(/Duplicate/)
    })

    it("should accept config with multiple unique agents", () => {
      const result = validateConfig({
        ...VALID_CONFIG,
        agents: [
          VALID_AGENT,
          { ...VALID_AGENT, id: "agent-two", name: "Agent Two" }
        ]
      })
      expect(result.ok).toBe(true)
      expect(result.data.agents).toHaveLength(2)
    })

    it("should accept config without optional fields", () => {
      const result = validateConfig({
        agents: [{ id: "minimal", name: "Minimal", personality: "Minimal personality for test." }]
      })
      expect(result.ok).toBe(true)
    })

    it("should reject non-object config", () => {
      const result = validateConfig("not an object")
      expect(result.ok).toBe(false)
    })

    it("should reject null config", () => {
      const result = validateConfig(null)
      expect(result.ok).toBe(false)
    })

    it("should provide field-level error details", () => {
      const result = validateConfig({
        agents: [{ id: "INVALID!", name: "" }]
      })
      expect(result.ok).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toHaveProperty("path")
      expect(result.errors[0]).toHaveProperty("message")
    })
  })
})


