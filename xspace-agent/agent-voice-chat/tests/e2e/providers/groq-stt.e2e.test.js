// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { describe, it, expect } from "vitest"
import { describeProvider, measureLatency } from "../setup.js"

describeProvider("groq-stt", () => {
  it("should transcribe audio with Groq Whisper", async () => {
    const axios = (await import("axios")).default
    const FormData = (await import("form-data")).default

    // Create a minimal valid WAV file with silence
    const sampleRate = 16000
    const durationSec = 1
    const numSamples = sampleRate * durationSec
    const dataSize = numSamples * 2
    const headerSize = 44
    const buffer = Buffer.alloc(headerSize + dataSize)

    // WAV header
    buffer.write("RIFF", 0)
    buffer.writeUInt32LE(36 + dataSize, 4)
    buffer.write("WAVE", 8)
    buffer.write("fmt ", 12)
    buffer.writeUInt32LE(16, 16)
    buffer.writeUInt16LE(1, 20)
    buffer.writeUInt16LE(1, 22)
    buffer.writeUInt32LE(sampleRate, 24)
    buffer.writeUInt32LE(sampleRate * 2, 28)
    buffer.writeUInt16LE(2, 32)
    buffer.writeUInt16LE(16, 34)
    buffer.write("data", 36)
    buffer.writeUInt32LE(dataSize, 40)

    const form = new FormData()
    form.append("file", buffer, { filename: "audio.wav", contentType: "audio/wav" })
    form.append("model", "whisper-large-v3")

    const { result, latencyMs } = await measureLatency(async () => {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        form,
        {
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            ...form.getHeaders(),
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      )
      return response.data
    })

    expect(result).toHaveProperty("text")
    expect(typeof result.text).toBe("string")
    // Groq is typically very fast for STT
    expect(latencyMs).toBeLessThan(15000)

    console.log(`[E2E] Groq STT: "${result.text}" (${latencyMs}ms)`)
  })
})


