// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// DEPRECATED: Use packages/core (xspace-agent) instead.
// This file is kept for backward compatibility with server.js.
// Will be removed in v1.0.

const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase()

function createProvider() {
  switch (AI_PROVIDER) {
    case "claude":
      return require("./claude")
    case "groq":
      return require("./groq")
    case "openai-chat":
      return require("./openai-chat")
    case "openai":
    default:
      return require("./openai-realtime")
  }
}

module.exports = { createProvider, AI_PROVIDER }


