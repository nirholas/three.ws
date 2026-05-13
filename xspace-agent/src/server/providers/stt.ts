// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§76]

import axios from "axios"
import FormData from "form-data"

export const STT_PROVIDER = (process.env.STT_PROVIDER || "groq").toLowerCase()
const GROQ_API_KEY = process.env.GROQ_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

export async function transcribe(
  audioBuffer: Buffer,
  mimeType = "audio/webm",
): Promise<{ text: string }> {
  const ext = mimeType.includes("wav") ? "wav" : "webm"
  const form = new FormData()
  form.append("file", audioBuffer, { filename: `audio.${ext}`, contentType: mimeType })
  form.append("model", STT_PROVIDER === "openai" ? "whisper-1" : "whisper-large-v3")

  const baseUrl =
    STT_PROVIDER === "openai"
      ? "https://api.openai.com/v1/audio/transcriptions"
      : "https://api.groq.com/openai/v1/audio/transcriptions"

  const apiKey = STT_PROVIDER === "openai" ? OPENAI_API_KEY : GROQ_API_KEY

  if (!apiKey) {
    throw new Error(`Missing API key for STT provider: ${STT_PROVIDER}`)
  }

  const response = await axios.post(baseUrl, form, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  })

  return { text: response.data.text || "" }
}


