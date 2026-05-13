// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

/**
 * @deprecated This legacy server entry point is deprecated and will be removed in a future release.
 * Use `packages/server/src/index.ts` instead.
 *   - `npm run dev`        → runs the new server (packages/server)
 *   - `npm run dev:legacy`  → runs this file
 * Migration guide: see packages/server/README.md
 */
console.warn(
  '\x1b[33m⚠  DEPRECATION WARNING: src/server/index.ts is deprecated. ' +
  'Use "npm run dev" (packages/server) instead. ' +
  'This entry point will be removed in v1.0.\x1b[0m'
)

import "dotenv/config"
import express from "express"
import http from "http"
import path from "path"
import { Server } from "socket.io"
import { createProvider, AI_PROVIDER } from "./providers"
import { loadAgentConfig } from "./agent-registry"
import { TurnManager } from "./turn-manager"
import { createRoutes } from "./routes"
import { createHealthRoutes } from "./routes/health"
import { setupGracefulShutdown } from "./shutdown"
import { registerSocketHandlers, registerXSpacesSocketHandlers } from "./socket-handlers"
import * as tts from "./providers/tts"
import { websocketConnections } from "./metrics"
import type { SpaceState, ServerConfig } from "./types"
import { serverLogger, xSpacesLogger } from "./logger"
import { globalRateLimit, expensiveRateLimit, authRateLimit } from "./middleware/rate-limit"
import { jsonBodyLimit, urlencodedBodyLimit, productionErrorHandler } from "./middleware/sanitize"
import { requireAuth, socketAuthMiddleware, logAuthWarning } from "./middleware/auth"
import { createCorsMiddleware } from "./middleware/cors"
import { createSecurityMiddleware } from "./middleware/security"

// ===== SHARED CONFIG =====
const PORT = parseInt(process.env.PORT || "3000", 10)
const CONTRACT = process.env.CONTRACT || process.env.CONTRACT_ADDRESS || ""
const PROJECT_NAME = process.env.PROJECT_NAME || "AI Agents"
const X_LINK = process.env.X_COMMUNITY_LINK || process.env.X_LINK || "https://x.com"
const GITHUB_LINK = process.env.GITHUB_LINK || "https://github.com"
const TOKEN_CHAIN = process.env.TOKEN_CHAIN || "Solana"
const WEBSITE = process.env.WEBSITE || process.env.WEBSITE_LINK || ""
const TEAM = process.env.TEAM || ""
const AVATAR_URL_1 = process.env.AVATAR_URL_1 || ""
const AVATAR_URL_2 = process.env.AVATAR_URL_2 || ""
const INPUT_CHAT = process.env.INPUT_CHAT !== "false"
const LIVE_CHAT = process.env.LIVE_CHAT !== "false"

const serverConfig: ServerConfig = {
  port: PORT,
  contract: CONTRACT,
  projectName: PROJECT_NAME,
  xLink: X_LINK,
  githubLink: GITHUB_LINK,
  tokenChain: TOKEN_CHAIN,
  website: WEBSITE,
  team: TEAM,
  avatarUrl1: AVATAR_URL_1,
  avatarUrl2: AVATAR_URL_2,
  inputChat: INPUT_CHAT,
  liveChat: LIVE_CHAT,
  tokenAddress: CONTRACT,
}

// ===== PROVIDER + AGENT CONFIG =====
const provider = createProvider()
const agentConfig = loadAgentConfig()

// ===== SPACE STATE =====
const spaceState: SpaceState = {
  agents: {
    0: { ...agentConfig.initialAgents[0] },
    1: { ...agentConfig.initialAgents[1] },
  },
  currentTurn: null,
  turnQueue: [],
  messages: [],
  isProcessing: false,
}

// ===== EXPRESS + HTTP =====
const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 5e6,
})

// Mount health/ready/metrics routes first (no auth, no middleware overhead)
app.use(createHealthRoutes({
  spaceState,
  getSocketConnectionCount: () => {
    try {
      return io.of("/space").sockets.size
    } catch {
      return 0
    }
  },
}))

// Security headers & CORS
app.use(createSecurityMiddleware())
app.use(createCorsMiddleware())

// Body size limits
app.use(express.json(jsonBodyLimit))
app.use(express.urlencoded(urlencodedBodyLimit))

// Global rate limiting
app.use(globalRateLimit)

// Static assets (no rate limiting needed for cached files)
app.use(express.static(path.join(process.cwd(), "public")))
app.use("/assets", express.static(path.join(process.cwd(), "dist/client")))

// Stricter rate limits for expensive endpoints
app.post("/api/agents/*/join", expensiveRateLimit)
app.post("/api/providers/verify", expensiveRateLimit)
app.post("/api/flows/*/test", expensiveRateLimit)
app.post("/api/auth/verify", authRateLimit)

// Auth middleware for API routes (after static files, so login.html is accessible)
app.use(requireAuth)

app.use(createRoutes(serverConfig, spaceState, provider, agentConfig.prompts, agentConfig.voices))

// ===== SOCKET.IO NAMESPACE =====
const spaceNS = io.of("/space")
const turnManager = new TurnManager(spaceState, spaceNS)

// Socket.IO auth for admin namespace
const adminNS = io.of("/admin")
adminNS.use(socketAuthMiddleware)

// Track WebSocket connections for metrics
spaceNS.on("connection", () => {
  websocketConnections.labels("/space").set(spaceNS.sockets.size)
})
spaceNS.on("disconnect", () => {
  websocketConnections.labels("/space").set(spaceNS.sockets.size)
})

registerSocketHandlers(spaceNS, spaceState, provider, turnManager, agentConfig.prompts)

// ===== GRACEFUL SHUTDOWN =====
setupGracefulShutdown(server, io)

// ===== X SPACES INTEGRATION =====
const X_SPACES_ENABLED = process.env.X_SPACES_ENABLED === "true"

if (X_SPACES_ENABLED) {
  const xSpaces = require("../../x-spaces") as {
    emitter: import("events").EventEmitter
    start(): Promise<void>
    stop(): Promise<void>
    joinSpace(url: string): Promise<void>
    leaveSpace(): Promise<void>
    speakInSpace(audioBuffer: Buffer): Promise<void>
    getStatus(): { status: string }
  }

  xSpacesLogger.info("module enabled")

  xSpaces.emitter.on("status", (status: string) => {
    xSpacesLogger.info({ status }, "status changed")
    spaceNS.emit("xSpacesStatus", { status })

    if (status === "speaking-in-space") {
      setTimeout(async () => {
        if (!turnManager.requestTurn(0)) return
        try {
          let intro = ""
          for await (const delta of provider.streamResponse!(
            0,
            "You just joined an X Space as a speaker. Say a short intro line in character — 1 sentence max, no hashtags.",
            agentConfig.prompts[0],
          )) {
            intro += delta
          }
          intro = intro.trim()
          if (!intro) intro = "yo i'm here, let's go"
          const audioBuffer = await tts.synthesize(intro, 0)
          if (audioBuffer) await xSpaces.speakInSpace(audioBuffer)
        } catch (e: unknown) {
          const err = e as { message?: string }
          xSpacesLogger.error({ err: err.message }, "intro error")
        } finally {
          turnManager.releaseTurn(0)
        }
      }, 2000)
    }
  })

  xSpaces.emitter.on("error", (err: string) => {
    xSpacesLogger.error({ err }, "error event")
    spaceNS.emit("xSpacesError", { error: err })
  })

  xSpaces.emitter.on("2fa-required", () => {
    spaceNS.emit("xSpaces2faRequired", {})
  })

  xSpaces.emitter.on("transcription", async ({ text }: { text: string }) => {
    xSpacesLogger.debug({ textLength: text.length }, "heard speech in Space")
    const userMsg = {
      id: Date.now().toString(),
      agentId: -1,
      name: "X Space Speaker",
      text,
      timestamp: Date.now(),
      isUser: true,
      source: "x-space",
    }
    spaceState.messages.push(userMsg)
    if (spaceState.messages.length > 100) spaceState.messages = spaceState.messages.slice(-100)
    spaceNS.emit("textComplete", userMsg)

    const agentId = 0
    if (!turnManager.requestTurn(agentId)) {
      xSpacesLogger.debug("already responding, skipping transcription")
      return
    }
    const messageId = Date.now().toString()
    const agentName = spaceState.agents[agentId]?.name

    spaceNS.emit("agentStatus", { agentId, status: "speaking", name: agentName })
    if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "speaking"
    turnManager.broadcastState()

    let fullText = ""
    try {
      for await (const delta of provider.streamResponse!(
        agentId,
        text,
        agentConfig.prompts[agentId],
      )) {
        fullText += delta
        spaceNS.emit("textDelta", { agentId, delta, messageId, name: agentName })
      }

      const msg = {
        id: messageId,
        agentId,
        name: agentName,
        text: fullText,
        timestamp: Date.now(),
      }
      spaceState.messages.push(msg)
      if (spaceState.messages.length > 100) spaceState.messages = spaceState.messages.slice(-100)
      spaceNS.emit("textComplete", msg)

      const audioBuffer = await tts.synthesize(fullText, agentId)
      if (audioBuffer) {
        await xSpaces.speakInSpace(audioBuffer)
        spaceNS.emit("ttsAudio", {
          agentId,
          audio: audioBuffer.toString("base64"),
          format: "mp3",
        })
      }
    } catch (err: unknown) {
      const error = err as { message?: string }
      xSpacesLogger.error({ err: error.message }, "response error")
    } finally {
      if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "idle"
      spaceNS.emit("agentStatus", { agentId, status: "idle", name: agentName })
      turnManager.releaseTurn(agentId)
    }
  })

  registerXSpacesSocketHandlers(spaceNS, xSpaces)

  if (process.env.X_USERNAME && process.env.X_PASSWORD) {
    setTimeout(() => {
      xSpacesLogger.info("auto-starting...")
      xSpaces
        .start()
        .catch((e: Error) => xSpacesLogger.error({ err: e.message }, "auto-start failed"))
    }, 3000)
  }
}

// ===== ERROR HANDLING =====
app.use(productionErrorHandler)

// ===== AUTH WARNING =====
logAuthWarning()

// ===== START SERVER =====
server.listen(PORT, () => {
  serverLogger.info(
    {
      port: PORT,
      aiProvider: AI_PROVIDER,
      providerType: provider.type,
      urls: {
        space: `http://localhost:${PORT}/`,
        bob: `http://localhost:${PORT}/bob`,
        alice: `http://localhost:${PORT}/alice`,
        admin: `http://localhost:${PORT}/admin`,
      },
    },
    "server started",
  )
})


