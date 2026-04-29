// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// Shared agent logic — UI helpers, Socket.IO handlers, audio analysis
class AgentCommon {
  constructor(config) {
    this.AGENT_ID = config.agentId
    this.AGENT_NAME = config.agentName
    this.SESSION_ENDPOINT = config.sessionEndpoint

    this.socket = io(config.namespace || "/space")
    this.isConnected = false
    this.hasTurn = false
    this.currentMessageId = null
    this.audioContext = null
    this.analyser = null
    this.isSpeaking = false
    this.speakingTimeout = null

    // DOM elements
    this.logPanel = document.getElementById("logPanel")
    this.chatPanel = document.getElementById("chatPanel")
    this.connectBtn = document.getElementById("connectBtn")
    this.connIndicator = document.getElementById("connIndicator")
    this.connStatus = document.getElementById("connStatus")
    this.agentStatus = document.getElementById("agentStatus")
    this.audioLevel = document.getElementById("audioLevel")
    this.turnStatus = document.getElementById("turnStatus")

    this._setupSocketHandlers()
    this._setupBeforeUnload()
  }

  log(msg, type = "") {
    const p = document.createElement("p")
    p.className = type
    p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
    this.logPanel.appendChild(p)
    this.logPanel.scrollTop = this.logPanel.scrollHeight
  }

  addChat(name, text, type = "") {
    const div = document.createElement("div")
    div.className = "chat-msg " + type
    div.innerHTML = `<strong>${name}:</strong> ${text}`
    this.chatPanel.appendChild(div)
    this.chatPanel.scrollTop = this.chatPanel.scrollHeight
  }

  setStatus(status) {
    this.agentStatus.textContent = status.charAt(0).toUpperCase() + status.slice(1)
    this.socket.emit("statusChange", { agentId: this.AGENT_ID, status })

    this.connIndicator.className = "status-indicator"
    if (status === "speaking") this.connIndicator.classList.add("speaking")
    else if (status === "listening") this.connIndicator.classList.add("listening")
    else if (this.isConnected) this.connIndicator.classList.add("connected")
  }

  updateTurnUI() {
    if (this.hasTurn) {
      this.turnStatus.className = "turn-status my-turn"
      this.turnStatus.textContent = "\ud83c\udf99\ufe0f Your turn to speak!"
    } else {
      this.turnStatus.className = "turn-status waiting"
      this.turnStatus.textContent = "\u23f3 Waiting for turn..."
    }
  }

  markConnected() {
    this.isConnected = true
    this.connIndicator.classList.add("connected")
    this.connStatus.textContent = "Connected"
    this.socket.emit("agentConnect", { agentId: this.AGENT_ID })
    this.setStatus("idle")
    this.connectBtn.textContent = "Connected"
    this.connectBtn.disabled = true
  }

  markDisconnected() {
    this.isConnected = false
    this.connIndicator.classList.remove("connected")
    this.connStatus.textContent = "Disconnected"
    this.socket.emit("agentDisconnect", { agentId: this.AGENT_ID })
    this.connectBtn.textContent = "Connect"
    this.connectBtn.disabled = false
  }

  setupAudioAnalysis(stream) {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 256
    this.analyser.smoothingTimeConstant = 0.3

    const source = this.audioContext.createMediaStreamSource(stream)
    source.connect(this.analyser)

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount)
    const SPEAK_THRESHOLD = 0.04
    const SILENCE_DURATION = 500

    this._audioInterval = setInterval(() => {
      if (!this.analyser) return
      this.analyser.getByteFrequencyData(dataArray)

      let sum = 0
      for (let i = 3; i < 25; i++) sum += dataArray[i]
      const level = (sum / 22) / 255

      this.audioLevel.style.width = Math.min(level * 150, 100) + "%"
      this.socket.emit("audioLevel", { agentId: this.AGENT_ID, level })

      if (level > SPEAK_THRESHOLD) {
        if (!this.isSpeaking) {
          this.isSpeaking = true
          this.setStatus("speaking")
          this.log("Speaking detected (audio)")
          if (this.onSpeechStart) this.onSpeechStart()
        }
        if (this.speakingTimeout) {
          clearTimeout(this.speakingTimeout)
          this.speakingTimeout = null
        }
      } else if (this.isSpeaking && !this.speakingTimeout) {
        this.speakingTimeout = setTimeout(() => {
          this.isSpeaking = false
          this.setStatus("idle")
          this.socket.emit("releaseTurn", { agentId: this.AGENT_ID })
          this.log("Stopped speaking (silence)")
          this.speakingTimeout = null
          if (this.onSpeechEnd) this.onSpeechEnd()
        }, SILENCE_DURATION)
      }
    }, 33)
  }

  _setupSocketHandlers() {
    this.socket.on("connect", () => {
      this.log("Socket connected", "success")
    })

    this.socket.on("stateUpdate", (data) => {
      if (data.currentTurn === this.AGENT_ID) {
        if (!this.hasTurn) {
          this.hasTurn = true
          this.updateTurnUI()
        }
      } else {
        this.hasTurn = false
        this.updateTurnUI()
      }
    })

    this.socket.on("turnGranted", ({ agentId }) => {
      if (agentId === this.AGENT_ID) {
        this.hasTurn = true
        this.updateTurnUI()
        this.log("Turn granted!", "success")
      }
    })

    this.socket.on("textComplete", (msg) => {
      if (msg.agentId !== this.AGENT_ID && msg.agentId >= 0) {
        this.addChat(msg.name, msg.text, "other")
      } else if (msg.isUser) {
        this.addChat(msg.name, msg.text, "user")
      }
    })
  }

  _setupBeforeUnload() {
    window.addEventListener("beforeunload", () => {
      this.socket.emit("agentDisconnect", { agentId: this.AGENT_ID })
    })
  }
}

// Export for use by provider scripts
window.AgentCommon = AgentCommon


