// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { vi } from "vitest"

describe("ContextInjector", () => {
  let ContextInjector, injector, mockMemoryStore, mockKnowledgeBase

  beforeEach(async () => {
    mockMemoryStore = {
      getUserProfile: vi.fn().mockReturnValue(null),
      searchMemories: vi.fn().mockResolvedValue([])
    }
    mockKnowledgeBase = {
      search: vi.fn().mockResolvedValue([])
    }

    // Import fresh
    const mod = await import("../../lib/context-injector")
    ContextInjector = mod.ContextInjector

    injector = new ContextInjector({
      memoryStore: mockMemoryStore,
      knowledgeBase: mockKnowledgeBase
    })
  })

  describe("getContext", () => {
    it("returns empty string when no relevant context found", async () => {
      const ctx = await injector.getContext({ userText: "hello", speaker: "@user" })
      expect(ctx).toBe("")
    })

    it("includes user profile facts when available", async () => {
      mockMemoryStore.getUserProfile.mockReturnValue({
        username: "@crypto",
        facts: ["Building a DEX on Solana", "Knows Rust"]
      })

      const ctx = await injector.getContext({ userText: "tell me about solana", speaker: "@crypto" })
      expect(ctx).toContain("What you know about @crypto")
      expect(ctx).toContain("Building a DEX on Solana")
      expect(ctx).toContain("Knows Rust")
    })

    it("includes relevant past memories", async () => {
      mockMemoryStore.searchMemories.mockResolvedValue([
        { content: "User was interested in DeFi protocols", score: 0.8 },
        { content: "User mentioned using Anchor framework", score: 0.7 }
      ])

      const ctx = await injector.getContext({ userText: "what about defi", speaker: "@user" })
      expect(ctx).toContain("Relevant past context")
      expect(ctx).toContain("interested in DeFi protocols")
      expect(ctx).toContain("Anchor framework")
    })

    it("includes knowledge base results", async () => {
      mockKnowledgeBase.search.mockResolvedValue([
        { content: "Total supply is 1 billion tokens", docName: "tokenomics.md", score: 0.9 }
      ])

      const ctx = await injector.getContext({ userText: "what are the tokenomics" })
      expect(ctx).toContain("Reference documents")
      expect(ctx).toContain("tokenomics.md")
      expect(ctx).toContain("Total supply is 1 billion tokens")
    })

    it("combines memory and knowledge context", async () => {
      mockMemoryStore.getUserProfile.mockReturnValue({
        username: "@user",
        facts: ["Interested in tokenomics"]
      })
      mockKnowledgeBase.search.mockResolvedValue([
        { content: "Token distribution schedule", docName: "whitepaper.md", score: 0.85 }
      ])

      const ctx = await injector.getContext({ userText: "token distribution", speaker: "@user" })
      expect(ctx).toContain("What you know about @user")
      expect(ctx).toContain("Reference documents")
      expect(ctx).toContain("CONTEXT")
    })

    it("includes instruction to use context naturally", async () => {
      mockKnowledgeBase.search.mockResolvedValue([
        { content: "some info", docName: "doc.md", score: 0.9 }
      ])

      const ctx = await injector.getContext({ userText: "test" })
      expect(ctx).toContain("use naturally")
      expect(ctx).toContain("don't mention you're reading from memory/docs")
    })

    it("handles errors gracefully", async () => {
      mockMemoryStore.searchMemories.mockRejectedValue(new Error("DB error"))
      mockKnowledgeBase.search.mockRejectedValue(new Error("Search error"))

      const ctx = await injector.getContext({ userText: "test", speaker: "@user" })
      expect(ctx).toBe("")
    })

    it("works without memoryStore", async () => {
      const injectorNoMem = new ContextInjector({
        memoryStore: null,
        knowledgeBase: mockKnowledgeBase
      })
      mockKnowledgeBase.search.mockResolvedValue([
        { content: "doc content", docName: "doc.md", score: 0.9 }
      ])

      const ctx = await injectorNoMem.getContext({ userText: "test" })
      expect(ctx).toContain("doc content")
    })

    it("works without knowledgeBase", async () => {
      const injectorNoKB = new ContextInjector({
        memoryStore: mockMemoryStore,
        knowledgeBase: null
      })
      mockMemoryStore.getUserProfile.mockReturnValue({
        username: "@user",
        facts: ["some fact"]
      })

      const ctx = await injectorNoKB.getContext({ userText: "test", speaker: "@user" })
      expect(ctx).toContain("some fact")
    })

    it("skips user profile section when profile has no facts", async () => {
      mockMemoryStore.getUserProfile.mockReturnValue({
        username: "@newuser",
        facts: []
      })

      const ctx = await injector.getContext({ userText: "test", speaker: "@newuser" })
      expect(ctx).not.toContain("What you know about")
    })
  })
})


