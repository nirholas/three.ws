// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

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

// Chatterbox (open-source, self-hosted) — runs locally via HTTP server
// See: https://github.com/resemble-ai/chatterbox
const CHATTERBOX_API_URL = (process.env.CHATTERBOX_API_URL || "http://localhost:8150").replace(/\/+$/, "")
const chatterboxVoiceRefMap = {
  0: process.env.CHATTERBOX_VOICE_REF_0 || "",
  1: process.env.CHATTERBOX_VOICE_REF_1 || ""
}

// Piper (open-source, self-hosted) — lightweight local TTS, runs on CPU
// See: https://github.com/rhasspy/piper
const PIPER_API_URL = (process.env.PIPER_API_URL || "http://localhost:5000").replace(/\/+$/, "")
const piperVoiceMap = {
  0: process.env.PIPER_VOICE_0 || "en_US-lessac-medium",
  1: process.env.PIPER_VOICE_1 || "en_US-amy-medium"
}

// Audio format varies by provider — cloud APIs return mp3, local models return wav
const TTS_FORMAT = ["chatterbox", "piper"].includes(TTS_PROVIDER) ? "wav" : "mp3"

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

/**
 * Chatterbox TTS — self-hosted, MIT-licensed, voice-cloning capable.
 * Expects a local HTTP server wrapping the Chatterbox Python model.
 *
 * API contract:
 *   POST {CHATTERBOX_API_URL}/v1/synthesize
 *   Body: { "text": "...", "speaker_audio": "/path/to/ref.wav" (optional) }
 *   Response: audio/wav binary
 */
async function synthesizeChatterbox(text, agentId = 0) {
  const body = { text }
  const voiceRef = chatterboxVoiceRefMap[agentId] || chatterboxVoiceRefMap[0]
  if (voiceRef) body.speaker_audio = voiceRef

  const response = await axios.post(
    `${CHATTERBOX_API_URL}/v1/synthesize`,
    body,
    {
      headers: { "Content-Type": "application/json" },
      responseType: "arraybuffer",
      timeout: 30000
    }
  )
  return Buffer.from(response.data)
}

/**
 * Piper TTS — self-hosted, lightweight, runs on CPU/Raspberry Pi.
 * Expects a Piper HTTP server (e.g. `piper --http-server --port 5000`).
 *
 * API contract:
 *   POST {PIPER_API_URL}/api/tts
 *   Body: { "text": "...", "voice": "en_US-lessac-medium" }
 *   Response: audio/wav binary
 */
async function synthesizePiper(text, agentId = 0) {
  const voice = piperVoiceMap[agentId] || piperVoiceMap[0]

  const response = await axios.post(
    `${PIPER_API_URL}/api/tts`,
    { text, voice },
    {
      headers: { "Content-Type": "application/json" },
      responseType: "arraybuffer",
      timeout: 15000
    }
  )
  return Buffer.from(response.data)
}

async function synthesize(text, agentId = 0, voice) {
  if (TTS_PROVIDER === "chatterbox") {
    return synthesizeChatterbox(text, agentId)
  }

  if (TTS_PROVIDER === "piper") {
    return synthesizePiper(text, agentId)
  }

  if (TTS_PROVIDER === "elevenlabs") {
    if (!ELEVENLABS_API_KEY) return null
    return synthesizeElevenLabs(text, agentId)
  }

  if (TTS_PROVIDER !== "openai") return null
  if (!OPENAI_API_KEY) return null

  const resolvedVoice = voice || voiceMap[agentId] || "alloy"

  const response = await axios.post(
    "https://api.openai.com/v1/audio/speech",
    {
      model: "tts-1",
      input: text,
      voice: resolvedVoice,
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

module.exports = { synthesize, TTS_PROVIDER, TTS_FORMAT, voiceMap }


