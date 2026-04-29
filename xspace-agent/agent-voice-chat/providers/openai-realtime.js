// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const axios = require("axios")

class OpenAIRealtimeProvider {
  static name = "openai"
  static requiredEnvVars = ["OPENAI_API_KEY"]

  constructor() {
    this.type = "webrtc"
    this.name = "openai"
    this.model = process.env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview-2024-12-17"
  }

  async createSession(agentId, prompts, voices) {
    const response = await axios.post(
      "https://api.openai.com/v1/realtime/sessions",
      {
        model: this.model,
        modalities: ["audio", "text"],
        voice: voices[agentId],
        instructions: prompts[agentId]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    )
    return response.data
  }
}

module.exports = OpenAIRealtimeProvider


