// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§70]

// DEPRECATED: Use packages/core (xspace-agent) instead.
// This file is kept for backward compatibility with server.js.
// Will be removed in v1.0.

const axios = require("axios")

const API_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview-2024-12-17"

module.exports = {
  type: "webrtc",

  async createSession(agentId, prompts, voices) {
    const response = await axios.post(
      "https://api.openai.com/v1/realtime/sessions",
      {
        model: MODEL,
        modalities: ["audio", "text"],
        voice: voices[agentId],
        instructions: prompts[agentId]
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    )
    return response.data
  }
}


