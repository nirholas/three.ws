// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§89]

import { Router } from "express"
import path from "path"
import type { Provider, ServerConfig, SpaceState } from "./types"
import { AI_PROVIDER } from "./providers"
import { TTS_PROVIDER } from "./providers/tts"
import { STT_PROVIDER } from "./providers/stt"
import { routeLogger } from "./logger"

export function createRoutes(
  config: ServerConfig,
  state: SpaceState,
  provider: Provider,
  prompts: Record<number, string>,
  voices: Record<number, string>,
): Router {
  const router = Router()
  const publicDir = path.join(process.cwd(), "public")

  router.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")))
  router.get("/bob", (_req, res) => res.sendFile(path.join(publicDir, "bob.html")))
  router.get("/alice", (_req, res) => res.sendFile(path.join(publicDir, "alice.html")))
  router.get("/admin", (_req, res) => res.sendFile(path.join(publicDir, "admin.html")))
  router.get("/builder", (_req, res) => res.sendFile(path.join(publicDir, "builder.html")))
  router.get("/landing", (_req, res) => res.sendFile(path.join(publicDir, "landing.html")))
  router.get("/hub", (_req, res) => res.redirect(301, "/"))

  // Server package pages
  router.get("/server-admin", (_req, res) => res.sendFile(path.join(publicDir, "server-admin.html")))
  router.get("/server-dashboard", (_req, res) => res.sendFile(path.join(publicDir, "server-dashboard.html")))
  router.get("/server-builder", (_req, res) => res.sendFile(path.join(publicDir, "server-builder.html")))
  router.get("/server-agent1", (_req, res) => res.sendFile(path.join(publicDir, "server-agent1.html")))
  router.get("/server-agent2", (_req, res) => res.sendFile(path.join(publicDir, "server-agent2.html")))

  // Voice chat pages
  router.get("/voice-chat", (_req, res) => res.sendFile(path.join(publicDir, "voice-chat.html")))
  router.get("/voice-chat-landing", (_req, res) => res.sendFile(path.join(publicDir, "voice-chat-landing.html")))
  router.get("/voice-chat-session", (_req, res) => res.sendFile(path.join(publicDir, "voice-chat-session.html")))

  // Contentium pages
  router.get("/contentium", (_req, res) => res.sendFile(path.join(publicDir, "contentium.html")))
  router.get("/contentium-v2", (_req, res) => res.sendFile(path.join(publicDir, "contentium-v2.html")))

  // Legacy & widget demos
  router.get("/legacy-admin", (_req, res) => res.sendFile(path.join(publicDir, "legacy-admin.html")))
  router.get("/widget-demo", (_req, res) => res.sendFile(path.join(publicDir, "widget-demo.html")))
  router.get("/react-widget-demo", (_req, res) => res.sendFile(path.join(publicDir, "react-widget-demo.html")))
  router.get("/vue-widget-demo", (_req, res) => res.sendFile(path.join(publicDir, "vue-widget-demo.html")))

  router.get("/config", (_req, res) =>
    res.json({
      inputChat: config.inputChat,
      liveChat: config.liveChat,
      xLink: config.xLink,
      githubLink: config.githubLink,
      avatarUrl1: config.avatarUrl1,
      avatarUrl2: config.avatarUrl2,
      aiProvider: AI_PROVIDER,
      providerType: provider.type,
      ttsMode: TTS_PROVIDER,
    }),
  )

  router.get("/state", (_req, res) =>
    res.json({
      agents: state.agents,
      currentTurn: state.currentTurn,
      messages: state.messages.slice(-50),
    }),
  )

  // --- Settings API ---
  router.get("/api/settings", (_req, res) => {
    res.json({
      auth: {
        method: process.env.X_AUTH_TOKEN ? "cookie" : process.env.X_USERNAME ? "credentials" : "cookie",
        hasAuthToken: !!process.env.X_AUTH_TOKEN,
        hasCt0: !!process.env.X_CT0,
        hasUsername: !!process.env.X_USERNAME,
        hasPassword: !!process.env.X_PASSWORD,
      },
      apiKeys: {
        hasOpenai: !!process.env.OPENAI_API_KEY,
        hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
        hasGroq: !!process.env.GROQ_API_KEY,
        hasElevenlabs: !!process.env.ELEVENLABS_API_KEY,
      },
      behavior: {
        aiProvider: AI_PROVIDER,
        sttProvider: STT_PROVIDER,
        ttsProvider: TTS_PROVIDER,
        headless: process.env.HEADLESS !== "false",
        autoJoin: process.env.AUTO_JOIN === "true",
      },
    })
  })

  router.post("/api/settings", (req, res) => {
    const { section, data } = req.body
    if (!section || !data || typeof data !== "object") {
      return res.status(400).json({ error: "Missing section or data" })
    }

    const updated: string[] = []

    if (section === "auth") {
      if (data.method === "cookie") {
        if (data.authToken) { process.env.X_AUTH_TOKEN = data.authToken; updated.push("X_AUTH_TOKEN") }
        if (data.ct0) { process.env.X_CT0 = data.ct0; updated.push("X_CT0") }
      } else if (data.method === "credentials") {
        if (data.username) { process.env.X_USERNAME = data.username; updated.push("X_USERNAME") }
        if (data.password) { process.env.X_PASSWORD = data.password; updated.push("X_PASSWORD") }
      }
    } else if (section === "apiKeys") {
      if (data.openai) { process.env.OPENAI_API_KEY = data.openai; updated.push("OPENAI_API_KEY") }
      if (data.anthropic) { process.env.ANTHROPIC_API_KEY = data.anthropic; updated.push("ANTHROPIC_API_KEY") }
      if (data.groq) { process.env.GROQ_API_KEY = data.groq; updated.push("GROQ_API_KEY") }
      if (data.elevenlabs) { process.env.ELEVENLABS_API_KEY = data.elevenlabs; updated.push("ELEVENLABS_API_KEY") }
    } else if (section === "behavior") {
      if (data.aiProvider) { process.env.AI_PROVIDER = data.aiProvider; updated.push("AI_PROVIDER") }
      if (data.sttProvider) { process.env.STT_PROVIDER = data.sttProvider; updated.push("STT_PROVIDER") }
      if (data.ttsProvider) { process.env.TTS_PROVIDER = data.ttsProvider; updated.push("TTS_PROVIDER") }
      if (data.headless !== undefined) { process.env.HEADLESS = data.headless ? "true" : "false"; updated.push("HEADLESS") }
      if (data.autoJoin !== undefined) { process.env.AUTO_JOIN = data.autoJoin ? "true" : "false"; updated.push("AUTO_JOIN") }
    } else {
      return res.status(400).json({ error: `Unknown section: ${section}` })
    }

    routeLogger.info({ section, updated }, "settings updated")
    res.json({ ok: true, updated })
  })

  router.get("/session/:agentId", async (req, res) => {
    const agentId = parseInt(req.params.agentId)
    if (agentId !== 0 && agentId !== 1) return res.status(400).json({ error: "Invalid agent ID" })
    if (provider.type !== "webrtc") return res.json({ type: "socket", provider: AI_PROVIDER })
    try {
      const data = await provider.createSession!(agentId, prompts, voices)
      res.json(data)
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown }; message?: string }
      routeLogger.error({ err: err.response?.data || err.message }, "session creation error")
      res.status(500).json({ error: "Failed to create session" })
    }
  })

  return router
}


