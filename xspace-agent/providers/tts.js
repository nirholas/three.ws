// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// DEPRECATED: Use packages/core (xspace-agent) instead.
// This file is kept for backward compatibility with server.js.
// Will be removed in v1.0.

const axios = require("axios")

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
const TTS_PROVIDER = (process.env.TTS_PROVIDER || (ELEVENLABS_API_KEY ? "elevenlabs" : OPENAI_API_KEY ? "openai" : "browser")).toLowerCase()

const voiceMap = {
  0: "onyx",
  1: "nova"
}

// ElevenLabs voice IDs — set ELEVENLABS_VOICE_0 / ELEVENLABS_VOICE_1 in .env to override
const elevenLabsVoiceMap = {
  0: process.env.ELEVENLABS_VOICE_0 || "VR6AewLTigWG4xSOukaG",
  1: process.env.ELEVENLABS_VOICE_1 || "TxGEqnHWrfWFTfGW9XjX"
}

async function synthesizeElevenLabs(text, agentId = 0) {
  const voiceId = elevenLabsVoiceMap[agentId] || elevenLabsVoiceMap[0]
  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true }
    },
    {
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      responseType: "arraybuffer"
    }
  )
  return Buffer.from(response.data)
}

async function synthesize(text, agentId = 0) {
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
      response_format: "mp3"
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      responseType: "arraybuffer"
    }
  )

  return Buffer.from(response.data)
}

module.exports = { synthesize, TTS_PROVIDER, voiceMap }


