// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { BaseSocketProvider } = require("./base-socket-provider")

class GroqProvider extends BaseSocketProvider {
  static name = "groq"
  static requiredEnvVars = ["GROQ_API_KEY"]

  constructor() {
    super()
    this.name = "groq"
  }

  getApiConfig() {
    return {
      url: "https://api.groq.com/openai/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
    }
  }
}

module.exports = GroqProvider


