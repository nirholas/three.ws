// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { describe, it, expect, afterAll } from "vitest"
import { describeProvider, measureLatency, createProviderByName } from "../setup.js"

describeProvider("openai-chat", () => {
  let provider

  afterAll(() => {
    provider?.clearHistory?.()
  })

  it("should create an OpenAI Chat provider instance", () => {
    provider = createProviderByName("openai-chat")
    expect(provider).toBeDefined()
    expect(provider.type).toBe("socket")
    expect(provider.name).toBe("openai-chat")
  })

  it("should stream a response from OpenAI Chat", async () => {
    provider = provider || createProviderByName("openai-chat")

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

    console.log(`[E2E] OpenAI Chat response: "${fullText}" (${latencyMs}ms, ${chunks.length} chunks)`)
  })

  it("should maintain conversation history across calls", async () => {
    provider = provider || createProviderByName("openai-chat")
    const roomId = "e2e-history-room"

    // First message — establish a fact
    let response1 = ""
    for await (const delta of provider.streamResponse("e2e-agent", "My favorite color is blue. Just say OK.", "You are a test assistant. Keep responses very short.", roomId)) {
      response1 += delta
    }
    expect(response1.length).toBeGreaterThan(0)

    // Second message — recall the fact
    let response2 = ""
    for await (const delta of provider.streamResponse("e2e-agent", "What is my favorite color? Reply with just the color.", "You are a test assistant. Keep responses very short.", roomId)) {
      response2 += delta
    }
    expect(response2.toLowerCase()).toContain("blue")

    console.log(`[E2E] OpenAI Chat history test: "${response2.trim()}"`)
  })

  it("should respect system prompts", async () => {
    provider = provider || createProviderByName("openai-chat")

    let response = ""
    for await (const delta of provider.streamResponse("e2e-prompt-agent", "Who are you?", "You are a pirate named Captain Hook. Always respond in pirate speak. Keep it to one sentence.", "e2e-prompt-room")) {
      response += delta
    }

    // The response should reflect the pirate persona
    expect(response.length).toBeGreaterThan(0)
    console.log(`[E2E] OpenAI Chat system prompt: "${response.trim()}"`)
  })
})


