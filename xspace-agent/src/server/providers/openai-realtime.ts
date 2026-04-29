// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import axios from "axios"
import type { Provider } from "../types"

const API_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview-2024-12-17"

async function createSession(
  agentId: number,
  prompts: Record<number, string>,
  voices: Record<number, string>,
): Promise<unknown> {
  const response = await axios.post(
    "https://api.openai.com/v1/realtime/sessions",
    {
      model: MODEL,
      modalities: ["audio", "text"],
      voice: voices[agentId],
      instructions: prompts[agentId],
    },
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
    },
  )
  return response.data
}

const provider: Provider = { type: "webrtc", createSession }
module.exports = provider


