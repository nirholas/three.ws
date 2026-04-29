// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import { describe, it, expect } from "vitest"
import { describeProvider, measureLatency } from "../setup.js"

describeProvider("openai-tts", () => {
  it("should synthesize speech with OpenAI TTS", async () => {
    // Import the real TTS module — it reads OPENAI_API_KEY from env
    const axios = (await import("axios")).default

    const { result: audioBuffer, latencyMs } = await measureLatency(async () => {
      const response = await axios.post(
        "https://api.openai.com/v1/audio/speech",
        {
          model: "tts-1",
          input: "Hello, this is an end-to-end test.",
          voice: "alloy",
          response_format: "mp3",
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          responseType: "arraybuffer",
        }
      )
      return Buffer.from(response.data)
    })

    expect(audioBuffer).toBeInstanceOf(Buffer)
    expect(audioBuffer.length).toBeGreaterThan(100) // MP3 should have meaningful size
    expect(latencyMs).toBeLessThan(30000)

    console.log(`[E2E] OpenAI TTS: ${audioBuffer.length} bytes (${latencyMs}ms)`)
  })

  it("should synthesize with different voices", async () => {
    const axios = (await import("axios")).default
    const voices = ["alloy", "nova"]
    const results = []

    for (const voice of voices) {
      const response = await axios.post(
        "https://api.openai.com/v1/audio/speech",
        {
          model: "tts-1",
          input: "Test.",
          voice,
          response_format: "mp3",
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          responseType: "arraybuffer",
        }
      )
      results.push({ voice, size: response.data.byteLength })
    }

    for (const r of results) {
      expect(r.size).toBeGreaterThan(100)
      console.log(`[E2E] OpenAI TTS voice "${r.voice}": ${r.size} bytes`)
    }
  })
})
