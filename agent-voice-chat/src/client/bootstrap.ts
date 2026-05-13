// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

import { AgentCommon } from "./core"
import { initOpenAIRealtime } from "./providers/webrtc"
import { initSocketProvider } from "./providers/streaming"

declare global {
  interface Window {
    AGENT_CONFIG?: {
      agentId: number
      agentName: string
      sessionEndpoint: string
      namespace?: string
    }
  }
}

;(async function () {
  const config = window.AGENT_CONFIG
  if (!config) {
    console.error("AGENT_CONFIG not set")
    return
  }

  const agent = new AgentCommon(config)

  try {
    const res = await fetch("/config")
    const serverConfig = await res.json()

    agent.log(`AI Provider: ${serverConfig.aiProvider} (${serverConfig.providerType} mode)`)

    if (serverConfig.providerType === "webrtc") {
      initOpenAIRealtime(agent)
    } else {
      initSocketProvider(agent)
    }
  } catch (err: unknown) {
    const error = err as Error
    agent.log("Failed to load config: " + error.message, "error")
  }
})()


