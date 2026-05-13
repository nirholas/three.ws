// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import type { Namespace, Socket } from "socket.io"
import type { Provider, SpaceState } from "./types"
import type { TurnManager } from "./turn-manager"
import { AI_PROVIDER } from "./providers"
import * as stt from "./providers/stt"
import * as tts from "./providers/tts"
import { socketLogger } from "./logger"
import { checkSocketRateLimit, cleanupSocketRateLimit } from "./middleware/rate-limit"
import { sanitizeMessage } from "./middleware/sanitize"
import { isValidSpaceUrl, isValid2faCode } from "./utils/security"

function isWallet(str: string): boolean {
  return !!str && str.length >= 32 && /^[a-zA-Z0-9]+$/.test(str)
}

function shortenNick(name: string): string {
  if (isWallet(name)) return name.slice(0, 4) + "..." + name.slice(-4)
  return name
}

async function handleLLMResponse(
  namespace: Namespace,
  socket: Socket,
  state: SpaceState,
  provider: Provider,
  turnManager: TurnManager,
  prompts: Record<number, string>,
  agentId: number,
  userText: string,
): Promise<void> {
  turnManager.requestTurn(agentId)
  const messageId = Date.now().toString()
  const agentName = state.agents[agentId]?.name

  namespace.emit("agentStatus", { agentId, status: "speaking", name: agentName })
  if (state.agents[agentId]) state.agents[agentId].status = "speaking"
  turnManager.broadcastState()

  let fullText = ""
  try {
    for await (const delta of provider.streamResponse!(agentId, userText, prompts[agentId])) {
      fullText += delta
      namespace.emit("textDelta", { agentId, delta, messageId, name: agentName })
    }

    const msg = { id: messageId, agentId, name: agentName, text: fullText, timestamp: Date.now() }
    state.messages.push(msg)
    if (state.messages.length > 100) state.messages = state.messages.slice(-100)
    namespace.emit("textComplete", msg)

    try {
      const audioBuffer = await tts.synthesize(fullText, agentId)
      if (audioBuffer) {
        socket.emit("ttsAudio", {
          agentId,
          audio: audioBuffer.toString("base64"),
          format: "mp3",
        })
      } else {
        socket.emit("ttsBrowser", { agentId, text: fullText })
      }
    } catch (ttsErr: unknown) {
      const err = ttsErr as { response?: { data?: unknown }; message?: string }
      const ttsErrData = err.response?.data
      const ttsErrMsg =
        Buffer.isBuffer(ttsErrData) ? ttsErrData.toString("utf8") : ttsErrData || err.message
      socketLogger.error({ err: ttsErrMsg }, "TTS error")
      socket.emit("ttsBrowser", { agentId, text: fullText })
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    socketLogger.error({ err: error.message, provider: AI_PROVIDER }, "LLM error")
  } finally {
    if (state.agents[agentId]) state.agents[agentId].status = "idle"
    namespace.emit("agentStatus", { agentId, status: "idle", name: agentName })
    turnManager.releaseTurn(agentId)
  }
}

export function registerSocketHandlers(
  namespace: Namespace,
  state: SpaceState,
  provider: Provider,
  turnManager: TurnManager,
  prompts: Record<number, string>,
): void {
  namespace.on("connection", (socket: Socket) => {
    socketLogger.info({ socketId: socket.id }, "client connected")

    socket.emit("stateUpdate", {
      agents: state.agents,
      currentTurn: state.currentTurn,
      turnQueue: state.turnQueue,
    })
    socket.emit("messageHistory", state.messages.slice(-50))

    socket.on("agentConnect", ({ agentId }: { agentId: number }) => {
      if (state.agents[agentId]) {
        state.agents[agentId].connected = true
        state.agents[agentId].status = "idle"
        state.agents[agentId].socketId = socket.id
        socketLogger.info({ agentId, name: state.agents[agentId].name }, "agent connected")
        turnManager.broadcastState()
      }
    })

    socket.on("agentDisconnect", ({ agentId }: { agentId: number }) => {
      if (state.agents[agentId]) {
        state.agents[agentId].connected = false
        state.agents[agentId].status = "offline"
        if (state.currentTurn === agentId) turnManager.releaseTurn(agentId)
        state.turnQueue = state.turnQueue.filter((id) => id !== agentId)
        socketLogger.info({ agentId }, "agent disconnected")
        turnManager.broadcastState()
      }
    })

    socket.on("statusChange", ({ agentId, status }: { agentId: number; status: string }) => {
      if (state.agents[agentId]) {
        state.agents[agentId].status = status as "idle" | "listening" | "speaking"
        namespace.emit("agentStatus", { agentId, status, name: state.agents[agentId].name })
        turnManager.broadcastState()
      }
    })

    socket.on("requestTurn", ({ agentId }: { agentId: number }) => {
      const granted = turnManager.requestTurn(agentId)
      socket.emit("turnResponse", { granted, currentTurn: state.currentTurn })
    })

    socket.on("releaseTurn", ({ agentId }: { agentId: number }) => turnManager.releaseTurn(agentId))

    socket.on("textDelta", ({ agentId, delta, messageId }: { agentId: number; delta: string; messageId: string }) => {
      namespace.emit("textDelta", { agentId, delta, messageId, name: state.agents[agentId]?.name })
    })

    socket.on("textComplete", ({ agentId, text, messageId }: { agentId: number; text: string; messageId: string }) => {
      const msg = {
        id: messageId,
        agentId,
        name: state.agents[agentId]?.name,
        text,
        timestamp: Date.now(),
      }
      state.messages.push(msg)
      if (state.messages.length > 100) state.messages = state.messages.slice(-100)
      namespace.emit("textComplete", msg)
    })

    socket.on(
      "audioData",
      async ({ agentId, audio, mimeType }: { agentId: number; audio: string; mimeType?: string }) => {
        if (provider.type === "webrtc") return
        try {
          namespace.emit("agentStatus", {
            agentId,
            status: "listening",
            name: state.agents[agentId]?.name,
          })
          if (state.agents[agentId]) state.agents[agentId].status = "listening"
          turnManager.broadcastState()

          const audioBuffer = Buffer.from(audio, "base64")
          const { text } = await stt.transcribe(audioBuffer, mimeType || "audio/webm")

          if (!text?.trim()) {
            if (state.agents[agentId]) state.agents[agentId].status = "idle"
            namespace.emit("agentStatus", {
              agentId,
              status: "idle",
              name: state.agents[agentId]?.name,
            })
            turnManager.broadcastState()
            return
          }

          socketLogger.debug({ agentId, textLength: text.length }, "STT transcription received")
          const userMsg = {
            id: Date.now().toString(),
            agentId: -1,
            name: "User (voice)",
            text,
            timestamp: Date.now(),
            isUser: true,
          }
          state.messages.push(userMsg)
          namespace.emit("textComplete", userMsg)
          await handleLLMResponse(namespace, socket, state, provider, turnManager, prompts, agentId, text)
        } catch (err: unknown) {
          const error = err as { message?: string }
          socketLogger.error({ err: error.message, agentId }, "audio pipeline error")
          if (state.agents[agentId]) state.agents[agentId].status = "idle"
          namespace.emit("agentStatus", {
            agentId,
            status: "idle",
            name: state.agents[agentId]?.name,
          })
          turnManager.broadcastState()
        }
      },
    )

    socket.on("userMessage", ({ text, from }: { text: string; from?: string }) => {
      if (!checkSocketRateLimit(socket)) return
      const sanitizedText = sanitizeMessage(text)
      if (!sanitizedText) return
      const sanitizedFrom = from ? sanitizeMessage(from) : "User"

      const msg = {
        id: Date.now().toString(),
        agentId: -1,
        name: sanitizedFrom,
        text: sanitizedText,
        timestamp: Date.now(),
        isUser: true,
      }
      state.messages.push(msg)
      namespace.emit("userMessage", msg)
      namespace.emit("textComplete", msg)
      if (provider.type === "socket") {
        handleLLMResponse(
          namespace,
          socket,
          state,
          provider,
          turnManager,
          prompts,
          0,
          `[CHAT - ${shortenNick(sanitizedFrom) || "User"}]: ${sanitizedText}`,
        )
      } else {
        namespace.emit("textToAgent", { text: sanitizedText, from: shortenNick(sanitizedFrom) || "User" })
      }
    })

    socket.on(
      "textToAgentDirect",
      async ({ agentId, text, from }: { agentId: number; text: string; from?: string }) => {
        if (!checkSocketRateLimit(socket)) return
        if (provider.type === "webrtc") return
        const sanitizedText = sanitizeMessage(text)
        if (!sanitizedText) return
        const sanitizedFrom = from ? sanitizeMessage(from) : undefined
        const chatText = sanitizedFrom ? `[CHAT - ${shortenNick(sanitizedFrom)}]: ${sanitizedText}` : sanitizedText
        await handleLLMResponse(namespace, socket, state, provider, turnManager, prompts, agentId, chatText)
      },
    )

    socket.on("audioLevel", ({ agentId, level }: { agentId: number; level: number }) =>
      namespace.emit("audioLevel", { agentId, level }),
    )

    socket.on("disconnect", () => {
      for (const id in state.agents) {
        if (state.agents[id].socketId === socket.id) {
          state.agents[id].connected = false
          state.agents[id].status = "offline"
          if (state.currentTurn === parseInt(id)) turnManager.releaseTurn(parseInt(id))
          state.turnQueue = state.turnQueue.filter((aid) => aid !== parseInt(id))
        }
      }
      cleanupSocketRateLimit(socket.id)
      turnManager.broadcastState()
      socketLogger.info({ socketId: socket.id }, "client disconnected")
    })
  })
}

export function registerXSpacesSocketHandlers(
  namespace: Namespace,
  xSpaces: {
    start(): Promise<void>
    stop(): Promise<void>
    joinSpace(url: string): Promise<void>
    leaveSpace(): Promise<void>
    getStatus(): { status: string }
    emitter: { emit(event: string, ...args: unknown[]): void }
  },
): void {
  namespace.on("connection", (socket: Socket) => {
    socket.on("xspace:start", async () => {
      try {
        await xSpaces.start()
      } catch (e: unknown) {
        const err = e as { message?: string }
        socket.emit("xSpacesError", { error: err.message })
      }
    })
    socket.on("xspace:join", async ({ spaceUrl }: { spaceUrl: string }) => {
      if (!isValidSpaceUrl(spaceUrl)) {
        socket.emit("xSpacesError", { error: "Invalid Space URL. Must be https://x.com/i/spaces/..." })
        return
      }
      try {
        await xSpaces.joinSpace(spaceUrl)
      } catch (e: unknown) {
        const err = e as { message?: string }
        socket.emit("xSpacesError", { error: err.message })
      }
    })
    socket.on("xspace:leave", async () => {
      try {
        await xSpaces.leaveSpace()
      } catch (e: unknown) {
        const err = e as { message?: string }
        socket.emit("xSpacesError", { error: err.message })
      }
    })
    socket.on("xspace:stop", async () => {
      try {
        await xSpaces.stop()
      } catch (e: unknown) {
        const err = e as { message?: string }
        socket.emit("xSpacesError", { error: err.message })
      }
    })
    socket.on("xspace:status", () => {
      socket.emit("xSpacesStatus", xSpaces.getStatus())
    })
    socket.on("xspace:2fa", ({ code }: { code: string }) => {
      if (!isValid2faCode(code)) {
        socket.emit("xSpacesError", { error: "Invalid 2FA code. Must be 6-8 digits." })
        return
      }
      xSpaces.emitter.emit("2fa-code", code)
    })
  })
}


