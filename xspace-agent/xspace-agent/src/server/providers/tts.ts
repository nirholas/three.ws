// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

import axios from "axios"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
export const TTS_PROVIDER = (
  process.env.TTS_PROVIDER ||
  (ELEVENLABS_API_KEY ? "elevenlabs" : OPENAI_API_KEY ? "openai" : "browser")
).toLowerCase()

export const voiceMap: Record<number, string> = {
  0: "onyx",
  1: "nova",
}

const elevenLabsVoiceMap: Record<number, string> = {
  0: process.env.ELEVENLABS_VOICE_0 || "VR6AewLTigWG4xSOukaG",
  1: process.env.ELEVENLABS_VOICE_1 || "TxGEqnHWrfWFTfGW9XjX",
}

async function synthesizeElevenLabs(text: string, agentId = 0): Promise<Buffer> {
  const voiceId = elevenLabsVoiceMap[agentId] || elevenLabsVoiceMap[0]
  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true },
    },
    {
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      responseType: "arraybuffer",
    },
  )
  return Buffer.from(response.data)
}

export async function synthesize(text: string, agentId = 0): Promise<Buffer | null> {
  if (TTS_PROVIDER === "elevenlabs") {
    if (!ELEVENLABS_API_KEY) return null
    return synthesizeElevenLabs(text, agentId)
  }

  if (TTS_PROVIDER !== "openai") return null
  if (!OPENAI_API_KEY) return null

  const response = await axios.post(
    "https://api.openai.com/v1/audio/speech",
    {
      model: "tts-1",
      input: text,
      voice: voiceMap[agentId] || "alloy",
      response_format: "mp3",
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      responseType: "arraybuffer",
    },
  )

  return Buffer.from(response.data)
}


