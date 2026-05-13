// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

const { BaseSocketProvider } = require("./base-socket-provider")

class OpenAIChatProvider extends BaseSocketProvider {
  static name = "openai-chat"
  static requiredEnvVars = ["OPENAI_API_KEY"]

  constructor() {
    super()
    this.name = "openai-chat"
  }

  getApiConfig() {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      model: process.env.OPENAI_MODEL || "gpt-4o-mini"
    }
  }
}

module.exports = OpenAIChatProvider
