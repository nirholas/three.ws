// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// Dynamic provider loader — fetches config and initializes the right provider
(async function() {
  // AGENT_CONFIG must be set before this script loads
  const config = window.AGENT_CONFIG
  if (!config) {
    console.error("AGENT_CONFIG not set")
    return
  }

  // Create the shared agent instance
  const agent = new AgentCommon(config)

  // Fetch server config to determine provider type
  try {
    const res = await fetch("/config")
    const serverConfig = await res.json()

    agent.log(`AI Provider: ${serverConfig.aiProvider} (${serverConfig.providerType} mode)`)

    if (serverConfig.providerType === "webrtc") {
      // Load OpenAI Realtime WebRTC provider
      initOpenAIRealtime(agent)
    } else {
      // Load Socket.IO-based provider (Claude/Groq)
      initSocketProvider(agent)
    }
  } catch (err) {
    agent.log("Failed to load config: " + err.message, "error")
  }
})()


