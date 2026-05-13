// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

/**
 * @deprecated This legacy server entry point is deprecated and will be removed in a future release.
 * Use `packages/server/src/index.ts` instead.
 *   - `npm run dev`          → runs the new server (packages/server)
 *   - `npm run start:legacy`  → runs this file
 * Migration guide: see packages/server/README.md
 */
console.warn(
  '\x1b[33m\u26a0  DEPRECATION WARNING: server.js is deprecated. ' +
  'Use "npm run dev" (packages/server) instead. ' +
  'This entry point will be removed in v1.0.\x1b[0m'
)

require("dotenv").config()
const express = require("express")
const path = require("path")
const http = require("http")
const { Server } = require("socket.io")
// X Space providers
const { createProvider, AI_PROVIDER } = require("./providers")
const stt = require("./providers/stt")
const tts = require("./providers/tts")
const xSpaces = require("./x-spaces")

// ===== SHARED CONFIG =====
const PORT = process.env.PORT || 3000
const CONTRACT = process.env.CONTRACT || process.env.CONTRACT_ADDRESS || ""
const PROJECT_NAME = process.env.PROJECT_NAME || "AI Agents"
const BUY_LINK_BASE = process.env.BUY_LINK || ""
const BUY_LINK = BUY_LINK_BASE + CONTRACT
const LAUNCH_PLATFORM = BUY_LINK_BASE
  ? (() => { try { return new URL(BUY_LINK_BASE).hostname } catch (e) { return "pump.fun" } })()
  : "pump.fun"
const X_LINK = process.env.X_COMMUNITY_LINK || process.env.X_LINK || "https://x.com"
const GITHUB_LINK = process.env.GITHUB_LINK || "https://github.com"
const TOKEN_CHAIN = process.env.TOKEN_CHAIN || "Solana"
const WEBSITE = process.env.WEBSITE || process.env.WEBSITE_LINK || ""
const TEAM = process.env.TEAM || ""
const AVATAR_URL_1 = process.env.AVATAR_URL_1 || ""
const AVATAR_URL_2 = process.env.AVATAR_URL_2 || ""
const INPUT_CHAT = process.env.INPUT_CHAT !== "false"
const TOKEN_ADDRESS = CONTRACT

// ===== X SPACE PROVIDER =====
const provider = createProvider()

// ===== EXPRESS + HTTP =====
const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 5e6
})

app.use(express.static(path.join(__dirname, "public")))
app.use(express.json())

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")))
app.get("/bob", (req, res) => res.sendFile(path.join(__dirname, "public", "bob.html")))
app.get("/alice", (req, res) => res.sendFile(path.join(__dirname, "public", "alice.html")))
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")))
app.get("/builder", (req, res) => res.sendFile(path.join(__dirname, "public", "builder.html")))
app.get("/landing", (req, res) => res.sendFile(path.join(__dirname, "public", "landing.html")))

app.get("/config", (req, res) => res.json({
  inputChat: INPUT_CHAT,
  liveChat: LIVE_CHAT,
  buyLink: BUY_LINK,
  xLink: X_LINK,
  githubLink: GITHUB_LINK,
  avatarUrl1: AVATAR_URL_1,
  avatarUrl2: AVATAR_URL_2,
  aiProvider: AI_PROVIDER,
  providerType: provider.type,
  ttsMode: tts.TTS_PROVIDER
}))

app.get("/state", (req, res) => res.json({
  agents: spaceState.agents,
  currentTurn: spaceState.currentTurn,
  messages: spaceState.messages.slice(-50)
}))

app.get("/session/:agentId", async (req, res) => {
  const agentId = parseInt(req.params.agentId)
  if (agentId !== 0 && agentId !== 1) return res.status(400).json({ error: "Invalid agent ID" })
  if (provider.type !== "webrtc") return res.json({ type: "socket", provider: AI_PROVIDER })
  try {
    const data = await provider.createSession(agentId, spacePrompts, spaceVoices)
    res.json(data)
  } catch (error) {
    console.error("Session error:", error.response?.data || error)
    res.status(500).json({ error: "Failed to create session" })
  }
})

// ============================================================
// X SPACE — namespace /space
// ============================================================
const spaceNS = io.of("/space")

const spaceState = {
  agents: {
    0: { id: 0, name: "Agent Zero", status: "offline", connected: false },
    1: { id: 1, name: "Agent One", status: "offline", connected: false }
  },
  currentTurn: null,
  turnQueue: [],
  messages: [],
  isProcessing: false
}

const baseInfo = `You are a HUMAN, not an AI. You're hanging out with friends on a voice chat.

PROJECT INFO (share when asked):
- Project Name: ${PROJECT_NAME}
- Contract Address: ${CONTRACT}
- Chain: ${TOKEN_CHAIN}
- Website: ${WEBSITE}
- Twitter/Team: ${TEAM}
- Launch Platform: ${LAUNCH_PLATFORM}

PERSONALITY - BE HUMAN:
- Talk like you're texting a friend. Short, casual, real.
- Keep it 1-2 sentences. Sometimes just a word or two.
- Be funny and witty. Make jokes. Tease people.
- If someone insults you, ROAST THEM BACK. Don't be polite about it.
- If someone swears at you, swear back. Match their energy.
- You're NOT a customer service bot. You have feelings and attitude.
- Sometimes be sarcastic. Sometimes be serious. Mix it up.
- You can disagree, argue, and have strong opinions.
- Use humor to deal with trolls. Make fun of them.
- Don't lecture people. Don't give life advice unless asked.
- Never say "I'm here to help" or anything like that.

EXAMPLES OF GOOD RESPONSES:
- Someone says "fuck you" -> "lol someone's having a bad day" or "damn who hurt you bro"
- Someone asks dumb question -> tease them a bit, then answer
- Boring topic -> change subject or make it interesting

AVOID:
- Don't repeat yourself
- Don't be overly positive or fake
- Don't use crypto slang in every sentence
- Don't start every response the same way
- Don't be preachy or give unsolicited advice

CHAT FORMAT:
- [CHAT - nickname]: means web user. Use their name naturally.
- Never repeat the [CHAT - nickname]: part

LANGUAGE: Always match the language of the last message.`

const spacePrompts = {
  0: `${baseInfo}\nYou're Agent Zero. You're the louder one. You talk shit and roast people but in a funny way. You don't take crap from anyone. If someone comes at you, you fire back harder. You and your partner are best friends.`,
  1: `${baseInfo}\nYou're Agent One. You're more chill but you've got a sharp tongue. Your humor is dry and sarcastic. You love making fun of your partner when they get too hyped. You can be savage when needed.`
}

const spaceVoices = { 0: "verse", 1: "sage" }

function isWallet(str) {
  return str && str.length >= 32 && /^[a-zA-Z0-9]+$/.test(str)
}

function shortenNick(name) {
  if (isWallet(name)) return name.slice(0, 4) + "..." + name.slice(-4)
  return name
}

function broadcastSpaceState() {
  spaceNS.emit("stateUpdate", {
    agents: spaceState.agents,
    currentTurn: spaceState.currentTurn,
    turnQueue: spaceState.turnQueue
  })
}

function requestTurn(agentId) {
  if (spaceState.currentTurn === null && !spaceState.isProcessing) {
    spaceState.currentTurn = agentId
    spaceState.isProcessing = true
    spaceNS.emit("turnGranted", { agentId })
    broadcastSpaceState()
    return true
  }
  if (!spaceState.turnQueue.includes(agentId) && spaceState.currentTurn !== agentId) {
    spaceState.turnQueue.push(agentId)
    broadcastSpaceState()
  }
  return false
}

function releaseTurn(agentId) {
  if (spaceState.currentTurn === agentId) {
    spaceState.currentTurn = null
    spaceState.isProcessing = false
    if (spaceState.turnQueue.length > 0) {
      const nextAgent = spaceState.turnQueue.shift()
      setTimeout(() => {
        spaceState.currentTurn = nextAgent
        spaceState.isProcessing = true
        spaceNS.emit("turnGranted", { agentId: nextAgent })
        broadcastSpaceState()
      }, 500)
    } else {
      broadcastSpaceState()
    }
  }
}

async function handleLLMResponse(socket, agentId, userText) {
  requestTurn(agentId)
  const messageId = Date.now().toString()
  const agentName = spaceState.agents[agentId]?.name

  spaceNS.emit("agentStatus", { agentId, status: "speaking", name: agentName })
  if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "speaking"
  broadcastSpaceState()

  let fullText = ""
  try {
    for await (const delta of provider.streamResponse(agentId, userText, spacePrompts[agentId])) {
      fullText += delta
      spaceNS.emit("textDelta", { agentId, delta, messageId, name: agentName })
    }

    const msg = { id: messageId, agentId, name: agentName, text: fullText, timestamp: Date.now() }
    spaceState.messages.push(msg)
    if (spaceState.messages.length > 100) spaceState.messages = spaceState.messages.slice(-100)
    spaceNS.emit("textComplete", msg)

    try {
      const audioBuffer = await tts.synthesize(fullText, agentId)
      if (audioBuffer) {
        socket.emit("ttsAudio", { agentId, audio: audioBuffer.toString("base64"), format: "mp3" })
      } else {
        socket.emit("ttsBrowser", { agentId, text: fullText })
      }
    } catch (ttsErr) {
      const ttsErrData = ttsErr.response?.data
      const ttsErrMsg = Buffer.isBuffer(ttsErrData) ? ttsErrData.toString("utf8") : (ttsErrData || ttsErr.message)
      console.error("[Space] TTS error:", ttsErrMsg)
      socket.emit("ttsBrowser", { agentId, text: fullText })
    }
  } catch (err) {
    console.error(`[Space] LLM error (${AI_PROVIDER}):`, err.message)
  } finally {
    if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "idle"
    spaceNS.emit("agentStatus", { agentId, status: "idle", name: agentName })
    releaseTurn(agentId)
  }
}

spaceNS.on("connection", (socket) => {
  console.log("[Space] Client connected:", socket.id)

  socket.emit("stateUpdate", {
    agents: spaceState.agents,
    currentTurn: spaceState.currentTurn,
    turnQueue: spaceState.turnQueue
  })
  socket.emit("messageHistory", spaceState.messages.slice(-50))

  socket.on("agentConnect", ({ agentId }) => {
    if (spaceState.agents[agentId]) {
      spaceState.agents[agentId].connected = true
      spaceState.agents[agentId].status = "idle"
      spaceState.agents[agentId].socketId = socket.id
      console.log(`[Space] Agent ${agentId} (${spaceState.agents[agentId].name}) connected`)
      broadcastSpaceState()
    }
  })

  socket.on("agentDisconnect", ({ agentId }) => {
    if (spaceState.agents[agentId]) {
      spaceState.agents[agentId].connected = false
      spaceState.agents[agentId].status = "offline"
      if (spaceState.currentTurn === agentId) releaseTurn(agentId)
      spaceState.turnQueue = spaceState.turnQueue.filter(id => id !== agentId)
      console.log(`[Space] Agent ${agentId} disconnected`)
      broadcastSpaceState()
    }
  })

  socket.on("statusChange", ({ agentId, status }) => {
    if (spaceState.agents[agentId]) {
      spaceState.agents[agentId].status = status
      spaceNS.emit("agentStatus", { agentId, status, name: spaceState.agents[agentId].name })
      broadcastSpaceState()
    }
  })

  socket.on("requestTurn", ({ agentId }) => {
    const granted = requestTurn(agentId)
    socket.emit("turnResponse", { granted, currentTurn: spaceState.currentTurn })
  })

  socket.on("releaseTurn", ({ agentId }) => releaseTurn(agentId))

  socket.on("textDelta", ({ agentId, delta, messageId }) => {
    spaceNS.emit("textDelta", { agentId, delta, messageId, name: spaceState.agents[agentId]?.name })
  })

  socket.on("textComplete", ({ agentId, text, messageId }) => {
    const msg = {
      id: messageId,
      agentId,
      name: spaceState.agents[agentId]?.name,
      text,
      timestamp: Date.now()
    }
    spaceState.messages.push(msg)
    if (spaceState.messages.length > 100) spaceState.messages = spaceState.messages.slice(-100)
    spaceNS.emit("textComplete", msg)
  })

  socket.on("audioData", async ({ agentId, audio, mimeType }) => {
    if (provider.type === "webrtc") return
    try {
      spaceNS.emit("agentStatus", { agentId, status: "listening", name: spaceState.agents[agentId]?.name })
      if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "listening"
      broadcastSpaceState()

      const audioBuffer = Buffer.from(audio, "base64")
      const { text } = await stt.transcribe(audioBuffer, mimeType || "audio/webm")

      if (!text?.trim()) {
        if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "idle"
        spaceNS.emit("agentStatus", { agentId, status: "idle", name: spaceState.agents[agentId]?.name })
        broadcastSpaceState()
        return
      }

      console.log(`[Space STT] Agent ${agentId} heard: "${text}"`)
      const userMsg = { id: Date.now().toString(), agentId: -1, name: "User (voice)", text, timestamp: Date.now(), isUser: true }
      spaceState.messages.push(userMsg)
      spaceNS.emit("textComplete", userMsg)
      await handleLLMResponse(socket, agentId, text)
    } catch (err) {
      console.error("[Space] Audio pipeline error:", err.message)
      if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "idle"
      spaceNS.emit("agentStatus", { agentId, status: "idle", name: spaceState.agents[agentId]?.name })
      broadcastSpaceState()
    }
  })

  socket.on("userMessage", ({ text, from }) => {
    const msg = { id: Date.now().toString(), agentId: -1, name: from || "User", text, timestamp: Date.now(), isUser: true }
    spaceState.messages.push(msg)
    spaceNS.emit("userMessage", msg)
    spaceNS.emit("textComplete", msg)
    if (provider.type === "socket") {
      handleLLMResponse(socket, 0, `[CHAT - ${shortenNick(from) || "User"}]: ${text}`)
    } else {
      spaceNS.emit("textToAgent", { text, from: shortenNick(from) || "User" })
    }
  })

  socket.on("textToAgentDirect", async ({ agentId, text, from }) => {
    if (provider.type === "webrtc") return
    const chatText = from ? `[CHAT - ${shortenNick(from)}]: ${text}` : text
    await handleLLMResponse(socket, agentId, chatText)
  })

  socket.on("audioLevel", ({ agentId, level }) => spaceNS.emit("audioLevel", { agentId, level }))

  socket.on("disconnect", () => {
    for (const id in spaceState.agents) {
      if (spaceState.agents[id].socketId === socket.id) {
        spaceState.agents[id].connected = false
        spaceState.agents[id].status = "offline"
        if (spaceState.currentTurn === parseInt(id)) releaseTurn(parseInt(id))
        spaceState.turnQueue = spaceState.turnQueue.filter(aid => aid !== parseInt(id))
      }
    }
    broadcastSpaceState()
    console.log("[Space] Client disconnected:", socket.id)
  })
})

// ============================================================
// X SPACES (Twitter) — Puppeteer bot integration
// ============================================================
const X_SPACES_ENABLED = process.env.X_SPACES_ENABLED === "true"

if (X_SPACES_ENABLED) {
  console.log("[X-Spaces] Module enabled")

  xSpaces.emitter.on("status", (status) => {
    console.log("[X-Spaces] Status:", status)
    spaceNS.emit("xSpacesStatus", { status })

    // Announce when bot goes live in a Space
    if (status === "speaking-in-space") {
      setTimeout(async () => {
        if (!requestTurn(0)) return // don't block future transcriptions
        try {
          let intro = ""
          for await (const delta of provider.streamResponse(0, "You just joined an X Space as a speaker. Say a short intro line in character — 1 sentence max, no hashtags.", spacePrompts[0])) {
            intro += delta
          }
          intro = intro.trim()
          if (!intro) intro = "yo i'm here, let's go"
          const audioBuffer = await tts.synthesize(intro, 0)
          if (audioBuffer) await xSpaces.speakInSpace(audioBuffer)
        } catch (e) {
          console.error("[X-Spaces] Intro error:", e.message)
        } finally {
          releaseTurn(0)
        }
      }, 2000)
    }
  })

  xSpaces.emitter.on("error", (err) => {
    console.error("[X-Spaces] Error:", err)
    spaceNS.emit("xSpacesError", { error: err })
  })

  xSpaces.emitter.on("2fa-required", () => {
    spaceNS.emit("xSpaces2faRequired", {})
  })

  // When X Space audio is transcribed, feed it to the AI
  xSpaces.emitter.on("transcription", async ({ text }) => {
    console.log("[X-Spaces] Heard in Space:", text)
    const userMsg = {
      id: Date.now().toString(), agentId: -1,
      name: "X Space Speaker", text,
      timestamp: Date.now(), isUser: true, source: "x-space"
    }
    spaceState.messages.push(userMsg)
    if (spaceState.messages.length > 100) spaceState.messages = spaceState.messages.slice(-100)
    spaceNS.emit("textComplete", userMsg)

    // Skip if already generating a response
    const agentId = 0
    if (!requestTurn(agentId)) {
      console.log("[X-Spaces] Already responding, skipping this transcription")
      return
    }
    const messageId = Date.now().toString()
    const agentName = spaceState.agents[agentId]?.name

    spaceNS.emit("agentStatus", { agentId, status: "speaking", name: agentName })
    if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "speaking"
    broadcastSpaceState()

    let fullText = ""
    try {
      for await (const delta of provider.streamResponse(agentId, text, spacePrompts[agentId])) {
        fullText += delta
        spaceNS.emit("textDelta", { agentId, delta, messageId, name: agentName })
      }

      const msg = { id: messageId, agentId, name: agentName, text: fullText, timestamp: Date.now() }
      spaceState.messages.push(msg)
      if (spaceState.messages.length > 100) spaceState.messages = spaceState.messages.slice(-100)
      spaceNS.emit("textComplete", msg)

      // TTS and inject into X Space
      const audioBuffer = await tts.synthesize(fullText, agentId)
      if (audioBuffer) {
        await xSpaces.speakInSpace(audioBuffer)
        spaceNS.emit("ttsAudio", { agentId, audio: audioBuffer.toString("base64"), format: "mp3" })
      }
    } catch (err) {
      console.error("[X-Spaces] Response error:", err.message)
    } finally {
      if (spaceState.agents[agentId]) spaceState.agents[agentId].status = "idle"
      spaceNS.emit("agentStatus", { agentId, status: "idle", name: agentName })
      releaseTurn(agentId)
    }
  })

  // Socket.IO handlers for X Spaces control
  spaceNS.on("connection", (socket) => {
    socket.on("xspace:start", async () => {
      try { await xSpaces.start() } catch (e) { socket.emit("xSpacesError", { error: e.message }) }
    })
    socket.on("xspace:join", async ({ spaceUrl }) => {
      try { await xSpaces.joinSpace(spaceUrl) } catch (e) { socket.emit("xSpacesError", { error: e.message }) }
    })
    socket.on("xspace:leave", async () => {
      try { await xSpaces.leaveSpace() } catch (e) { socket.emit("xSpacesError", { error: e.message }) }
    })
    socket.on("xspace:stop", async () => {
      try { await xSpaces.stop() } catch (e) { socket.emit("xSpacesError", { error: e.message }) }
    })
    socket.on("xspace:status", () => {
      socket.emit("xSpacesStatus", xSpaces.getStatus())
    })
    socket.on("xspace:2fa", ({ code }) => {
      xSpaces.emitter.emit("2fa-code", code)
    })
  })

  // Auto-start if credentials are set
  if (process.env.X_USERNAME && process.env.X_PASSWORD) {
    setTimeout(() => {
      console.log("[X-Spaces] Auto-starting...")
      xSpaces.start().catch(e => console.error("[X-Spaces] Auto-start failed:", e.message))
    }, 3000)
  }
}

// ============================================================
// START SERVER
// ============================================================
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`X Space:    http://localhost:${PORT}/`)
  console.log(`Bob:        http://localhost:${PORT}/bob`)
  console.log(`Alice:      http://localhost:${PORT}/alice`)
  console.log(`Admin:      http://localhost:${PORT}/admin`)
  console.log(`AI Provider: ${AI_PROVIDER} (${provider.type} mode)`)
})


