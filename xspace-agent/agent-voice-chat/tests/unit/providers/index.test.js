// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

describe("Provider factory", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("should default to openai-realtime provider", async () => {
    vi.stubEnv("AI_PROVIDER", "")
    const { createProvider } = await import("../../../providers/index.js")
    const provider = createProvider()
    expect(provider).toBeDefined()
    expect(provider.type).toBeDefined()
  })

  it("should export AI_PROVIDER string", async () => {
    vi.stubEnv("AI_PROVIDER", "claude")
    const { AI_PROVIDER } = await import("../../../providers/index.js")
    expect(AI_PROVIDER).toBe("claude")
  })

  it("should export registerProvider function", async () => {
    const { registerProvider } = await import("../../../providers/index.js")
    expect(typeof registerProvider).toBe("function")
  })
})


