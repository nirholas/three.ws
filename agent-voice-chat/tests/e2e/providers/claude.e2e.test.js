// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import { describe, it, expect, afterAll } from "vitest"
import { describeProvider, measureLatency, createProviderByName } from "../setup.js"

describeProvider("claude", () => {
  let provider

  afterAll(() => {
    provider?.clearHistory?.()
  })

  it("should create a Claude provider instance", () => {
    provider = createProviderByName("claude")
    expect(provider).toBeDefined()
    expect(provider.type).toBe("socket")
    expect(provider.name).toBe("claude")
  })

  it("should stream a response from Claude", async () => {
    provider = provider || createProviderByName("claude")

    const chunks = []
    const { latencyMs } = await measureLatency(async () => {
      for await (const delta of provider.streamResponse("e2e-agent", "Say hello in exactly 3 words.", "You are a test assistant.", "e2e-room")) {
        chunks.push(delta)
      }
    })

    const fullText = chunks.join("")
    expect(fullText.length).toBeGreaterThan(0)
    expect(chunks.length).toBeGreaterThan(0)
    expect(latencyMs).toBeLessThan(30000)

    console.log(`[E2E] Claude response: "${fullText}" (${latencyMs}ms, ${chunks.length} chunks)`)
  })

  it("should maintain conversation history across calls", async () => {
    provider = provider || createProviderByName("claude")
    const roomId = "e2e-claude-history"

    let response1 = ""
    for await (const delta of provider.streamResponse("e2e-agent", "My favorite number is 42. Just say OK.", "You are a test assistant. Keep responses very short.", roomId)) {
      response1 += delta
    }
    expect(response1.length).toBeGreaterThan(0)

    let response2 = ""
    for await (const delta of provider.streamResponse("e2e-agent", "What is my favorite number? Reply with just the number.", "You are a test assistant. Keep responses very short.", roomId)) {
      response2 += delta
    }
    expect(response2).toContain("42")

    console.log(`[E2E] Claude history test: "${response2.trim()}"`)
  })

  it("should respect system prompts", async () => {
    provider = provider || createProviderByName("claude")

    let response = ""
    for await (const delta of provider.streamResponse("e2e-prompt-agent", "Who are you?", "You are a robot named Beep. Always respond with robot sounds. Keep it to one sentence.", "e2e-claude-prompt")) {
      response += delta
    }

    expect(response.length).toBeGreaterThan(0)
    console.log(`[E2E] Claude system prompt: "${response.trim()}"`)
  })
})
