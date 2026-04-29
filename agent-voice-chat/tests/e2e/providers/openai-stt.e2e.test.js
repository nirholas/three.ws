// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import { describe, it, expect } from "vitest"
import { describeProvider, measureLatency } from "../setup.js"

describeProvider("openai-stt", () => {
  it("should transcribe audio with OpenAI Whisper", async () => {
    const axios = (await import("axios")).default
    const FormData = (await import("form-data")).default

    // Create a minimal valid WAV file with silence (44-byte header + PCM data)
    const sampleRate = 16000
    const durationSec = 1
    const numSamples = sampleRate * durationSec
    const dataSize = numSamples * 2 // 16-bit mono
    const headerSize = 44
    const buffer = Buffer.alloc(headerSize + dataSize)

    // WAV header
    buffer.write("RIFF", 0)
    buffer.writeUInt32LE(36 + dataSize, 4)
    buffer.write("WAVE", 8)
    buffer.write("fmt ", 12)
    buffer.writeUInt32LE(16, 16) // chunk size
    buffer.writeUInt16LE(1, 20)  // PCM
    buffer.writeUInt16LE(1, 22)  // mono
    buffer.writeUInt32LE(sampleRate, 24)
    buffer.writeUInt32LE(sampleRate * 2, 28) // byte rate
    buffer.writeUInt16LE(2, 32) // block align
    buffer.writeUInt16LE(16, 34) // bits per sample
    buffer.write("data", 36)
    buffer.writeUInt32LE(dataSize, 40)
    // PCM data is already zero-filled (silence)

    const form = new FormData()
    form.append("file", buffer, { filename: "audio.wav", contentType: "audio/wav" })
    form.append("model", "whisper-1")

    const { result, latencyMs } = await measureLatency(async () => {
      const response = await axios.post(
        "https://api.openai.com/v1/audio/transcriptions",
        form,
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            ...form.getHeaders(),
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      )
      return response.data
    })

    // Silence should return empty or very short text
    expect(result).toHaveProperty("text")
    expect(typeof result.text).toBe("string")
    expect(latencyMs).toBeLessThan(30000)

    console.log(`[E2E] OpenAI STT: "${result.text}" (${latencyMs}ms)`)
  })
})
