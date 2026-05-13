// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import { describe, it, expect, afterAll } from "vitest"
import { describeProvider, measureLatency, createProviderByName } from "../setup.js"

describeProvider("groq", () => {
  let provider

  afterAll(() => {
    provider?.clearHistory?.()
  })

  it("should create a Groq provider instance", () => {
    provider = createProviderByName("groq")
    expect(provider).toBeDefined()
    expect(provider.type).toBe("socket")
    expect(provider.name).toBe("groq")
  })

  it("should stream a response from Groq", async () => {
    provider = provider || createProviderByName("groq")

    const chunks = []
    const { latencyMs } = await measureLatency(async () => {
      for await (const delta of provider.streamResponse("e2e-agent", "Say hello in exactly 3 words.", "You are a test assistant.", "e2e-room")) {
        chunks.push(delta)
      }
    })

    const fullText = chunks.join("")
    expect(fullText.length).toBeGreaterThan(0)
    expect(chunks.length).toBeGreaterThan(0)
    // Groq is typically very fast
    expect(latencyMs).toBeLessThan(15000)

    console.log(`[E2E] Groq response: "${fullText}" (${latencyMs}ms, ${chunks.length} chunks)`)
  })

  it("should maintain conversation history across calls", async () => {
    provider = provider || createProviderByName("groq")
    const roomId = "e2e-groq-history"

    let response1 = ""
    for await (const delta of provider.streamResponse("e2e-agent", "My pet is a cat named Whiskers. Just say OK.", "You are a test assistant. Keep responses very short.", roomId)) {
      response1 += delta
    }
    expect(response1.length).toBeGreaterThan(0)

    let response2 = ""
    for await (const delta of provider.streamResponse("e2e-agent", "What is my pet's name? Reply with just the name.", "You are a test assistant. Keep responses very short.", roomId)) {
      response2 += delta
    }
    expect(response2.toLowerCase()).toContain("whiskers")

    console.log(`[E2E] Groq history test: "${response2.trim()}"`)
  })
})
