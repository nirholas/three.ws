// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { describe, it, expect } from "vitest"
import { describeProvider, measureLatency } from "../setup.js"

describeProvider("elevenlabs", () => {
  it("should synthesize speech with ElevenLabs", async () => {
    const axios = (await import("axios")).default

    const voiceId = process.env.ELEVENLABS_VOICE_0 || "VR6AewLTigWG4xSOukaG"

    const { result: audioBuffer, latencyMs } = await measureLatency(async () => {
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          text: "Hello, this is an end-to-end test.",
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true },
        },
        {
          headers: {
            "xi-api-key": process.env.ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          responseType: "arraybuffer",
        }
      )
      return Buffer.from(response.data)
    })

    expect(audioBuffer).toBeInstanceOf(Buffer)
    expect(audioBuffer.length).toBeGreaterThan(100)
    expect(latencyMs).toBeLessThan(30000)

    console.log(`[E2E] ElevenLabs TTS: ${audioBuffer.length} bytes (${latencyMs}ms)`)
  })
})


