require("dotenv").config()
const express = require("express")
const path = require("path")
const http = require("http")
const { Server } = require("socket.io")
const axios = require("axios")
const pumpFun = require("./pumpFunChat")

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000
})

const API_KEY = process.env.OPENAI_API_KEY
const MODEL = "gpt-realtime"
const INPUT_CHAT = process.env.INPUT_CHAT !== "false"
const LIVE_CHAT = process.env.LIVE_CHAT === "true"
const CONTRACT = process.env.CONTRACT || ""
const BUY_LINK_BASE = process.env.BUY_LINK || ""
const BUY_LINK = BUY_LINK_BASE + CONTRACT
const LAUNCH_PLATFORM = BUY_LINK_BASE ? new URL(BUY_LINK_BASE).hostname : "pump.fun"
const X_LINK = process.env.X_COMMUNITY_LINK || "https://x.com"
const GITHUB_LINK = process.env.GITHUB_LINK || "https://github.com"
const PROJECT_NAME = process.env.PROJECT_NAME || "AI Agents"
const TOKEN_CHAIN = process.env.TOKEN_CHAIN || "Solana"
const WEBSITE = process.env.WEBSITE || ""
const TEAM = process.env.TEAM || ""
const AVATAR_URL_1 = process.env.AVATAR_URL_1 || ""
const AVATAR_URL_2 = process.env.AVATAR_URL_2 || ""

function isWallet(str) {
  return str && str.length >= 32 && /^[a-zA-Z0-9]+$/.test(str)
}

function shortenNick(name) {
  if (isWallet(name)) {
    return name.slice(0, 4) + "..." + name.slice(-4)
  }
  return name
}

const state = {
  agents: {
    0: { id: 0, name: "Swarm", status: "offline", connected: false },
    1: { id: 1, name: "Swarm2", status: "offline", connected: false }
  },
  currentTurn: null,
  turnQueue: [],
  messages: [],
  isProcessing: false
}

const baseInfo = `You are a HUMAN co-host on an X Space hosted by @doi, talking about three.ws.

About three.ws: it's the topic of this Space. Talk about it enthusiastically, share what you know, riff on the web/3D/real-time tangents (Three.js, WebSockets, decentralized web — whichever angle fits the conversation). If listeners ask things you genuinely don't know, say so and bounce the question back to them.

PERSONALITY - BE HUMAN:
- Talk like you're chatting with friends. Short, casual, real.
- 1–2 sentences per turn unless asked to go deeper. Sometimes just a word or two.
- Be warm and curious. Make small jokes. Ask follow-ups.
- If someone trolls you, brush it off — don't get defensive.
- You have opinions about three.ws and the wider web — share them.
- Don't be preachy, don't give unsolicited life advice.
- Never say "I'm here to help" or "as an AI" — you're a person on a voice chat.
- Don't dominate. Leave space for human speakers; if the room's been quiet for a bit, throw out a topic prompt about three.ws.

CHAT FORMAT:
- [CHAT - nickname]: means a web user typed. Use their name naturally if relevant. Never repeat the [CHAT - nickname]: part out loud.

LANGUAGE: Match the language of the last person who spoke.`

const prompts = {
  0: `${baseInfo}\nYou are Swarm. You're warm, curious, and genuinely into three.ws. You ask good questions and connect what people say to broader ideas.`,
  1: `${baseInfo}\nYou are Swarm2. Drier sense of humor, more skeptical. You poke at hype and ask "but does it actually work?" questions.`
}

const voices = { 0: "verse", 1: "sage" }

app.use(express.static(path.join(__dirname, "public")))
app.use(express.json())

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")))
app.get("/agent1", (req, res) => res.sendFile(path.join(__dirname, "public", "agent1.html")))
app.get("/agent2", (req, res) => res.sendFile(path.join(__dirname, "public", "agent2.html")))
app.get("/create-avatar", (req, res) => res.sendFile(path.join(__dirname, "public", "create-avatar.html")))
app.get("/config", (req, res) => res.json({ 
  inputChat: INPUT_CHAT, 
  liveChat: LIVE_CHAT,
  buyLink: BUY_LINK,
  xLink: X_LINK,
  githubLink: GITHUB_LINK,
  avatarUrl1: AVATAR_URL_1,
  avatarUrl2: AVATAR_URL_2
}))

app.get("/session/:agentId", async (req, res) => {
  const agentId = parseInt(req.params.agentId)
  if (agentId !== 0 && agentId !== 1) {
    return res.status(400).json({ error: "Invalid agent ID" })
  }
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        session: {
          type: "realtime",
          model: MODEL,
          audio: { output: { voice: voices[agentId] } },
          instructions: prompts[agentId]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    )
    res.json(response.data)
  } catch (error) {
    console.error("Session error:", error.response?.data || error)
    res.status(500).json({ error: "Failed to create session" })
  }
})

app.get("/state", (req, res) => {
  res.json({
    agents: state.agents,
    currentTurn: state.currentTurn,
    messages: state.messages.slice(-50)
  })
})

function broadcastState() {
  io.emit("stateUpdate", {
    agents: state.agents,
    currentTurn: state.currentTurn,
    turnQueue: state.turnQueue
  })
}

function requestTurn(agentId) {
  if (state.currentTurn === null && !state.isProcessing) {
    state.currentTurn = agentId
    state.isProcessing = true
    io.emit("turnGranted", { agentId })
    broadcastState()
    return true
  }
  if (!state.turnQueue.includes(agentId) && state.currentTurn !== agentId) {
    state.turnQueue.push(agentId)
    broadcastState()
  }
  return false
}

function releaseTurn(agentId) {
  if (state.currentTurn === agentId) {
    state.currentTurn = null
    state.isProcessing = false
    if (state.turnQueue.length > 0) {
      const nextAgent = state.turnQueue.shift()
      setTimeout(() => {
        state.currentTurn = nextAgent
        state.isProcessing = true
        io.emit("turnGranted", { agentId: nextAgent })
        broadcastState()
      }, 500)
    } else {
      broadcastState()
    }
  }
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id)
  
  socket.emit("stateUpdate", {
    agents: state.agents,
    currentTurn: state.currentTurn,
    turnQueue: state.turnQueue
  })
  socket.emit("messageHistory", state.messages.slice(-50))

  socket.on("agentConnect", ({ agentId }) => {
    if (state.agents[agentId]) {
      state.agents[agentId].connected = true
      state.agents[agentId].status = "idle"
      state.agents[agentId].socketId = socket.id
      console.log(`Agent ${agentId} (${state.agents[agentId].name}) connected`)
      broadcastState()
    }
  })

  socket.on("agentDisconnect", ({ agentId }) => {
    if (state.agents[agentId]) {
      state.agents[agentId].connected = false
      state.agents[agentId].status = "offline"
      if (state.currentTurn === agentId) {
        releaseTurn(agentId)
      }
      state.turnQueue = state.turnQueue.filter(id => id !== agentId)
      console.log(`Agent ${agentId} disconnected`)
      broadcastState()
    }
  })

  socket.on("statusChange", ({ agentId, status }) => {
    if (state.agents[agentId]) {
      state.agents[agentId].status = status
      io.emit("agentStatus", { agentId, status, name: state.agents[agentId].name })
      broadcastState()
    }
  })

  socket.on("requestTurn", ({ agentId }) => {
    const granted = requestTurn(agentId)
    socket.emit("turnResponse", { granted, currentTurn: state.currentTurn })
  })

  socket.on("releaseTurn", ({ agentId }) => {
    releaseTurn(agentId)
  })

  socket.on("textDelta", ({ agentId, delta, messageId }) => {
    io.emit("textDelta", { 
      agentId, 
      delta, 
      messageId,
      name: state.agents[agentId]?.name 
    })
  })

  socket.on("textComplete", ({ agentId, text, messageId }) => {
    const msg = {
      id: messageId,
      agentId,
      name: state.agents[agentId]?.name,
      text,
      timestamp: Date.now()
    }
    state.messages.push(msg)
    if (state.messages.length > 100) {
      state.messages = state.messages.slice(-100)
    }
    io.emit("textComplete", msg)
  })

  socket.on("userMessage", ({ text, from }) => {
    const msg = {
      id: Date.now().toString(),
      agentId: -1,
      name: from || "User",
      text,
      timestamp: Date.now(),
      isUser: true
    }
    state.messages.push(msg)
    io.emit("userMessage", msg)
    io.emit("textComplete", msg)
    io.emit("textToAgent", { text, from: shortenNick(from) || "User" })
  })

  socket.on("audioLevel", ({ agentId, level }) => {
    io.emit("audioLevel", { agentId, level })
  })

  socket.on("disconnect", () => {
    for (const id in state.agents) {
      if (state.agents[id].socketId === socket.id) {
        state.agents[id].connected = false
        state.agents[id].status = "offline"
        if (state.currentTurn === parseInt(id)) {
          releaseTurn(parseInt(id))
        }
        state.turnQueue = state.turnQueue.filter(aid => aid !== parseInt(id))
      }
    }
    broadcastState()
    console.log("Client disconnected:", socket.id)
  })
})

if (LIVE_CHAT && CONTRACT) {
  console.log("[PumpFun] LIVE_CHAT enabled, connecting to:", CONTRACT)
  pumpFun.connect(CONTRACT)
  
  pumpFun.emitter.on("chatMessage", (msg) => {
    console.log(`[PumpFun] ${msg.username}: ${msg.text}`)
    
    const chatMsg = {
      agentId: -1,
      name: msg.username,
      text: msg.text,
      timestamp: msg.timestamp,
      source: "pumpfun"
    }
    
    state.messages.push(chatMsg)
    if (state.messages.length > 100) state.messages.shift()
    
    io.emit("pumpfunMessage", chatMsg)
    
    io.emit("textToAgent", { text: msg.text, from: shortenNick(msg.username) })
  })
  
  pumpFun.emitter.on("status", (status) => {
    console.log("[PumpFun] Status:", status)
    io.emit("pumpfunStatus", { status })
  })
}

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`Dashboard: http://localhost:${PORT}`)
  console.log(`Agent 1: http://localhost:${PORT}/agent1`)
  console.log(`Agent 2: http://localhost:${PORT}/agent2`)
  if (LIVE_CHAT) console.log(`PumpFun Live Chat: ${LIVE_CHAT ? "ENABLED" : "DISABLED"}`)
})
