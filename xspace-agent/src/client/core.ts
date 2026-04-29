// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { io, Socket } from "socket.io-client"

export interface AgentClientConfig {
  agentId: number
  agentName: string
  sessionEndpoint: string
  namespace?: string
}

export class AgentCommon {
  AGENT_ID: number
  AGENT_NAME: string
  SESSION_ENDPOINT: string

  socket: Socket
  isConnected = false
  hasTurn = false
  currentMessageId: string | null = null
  audioContext: AudioContext | null = null
  analyser: AnalyserNode | null = null
  isSpeaking = false
  speakingTimeout: ReturnType<typeof setTimeout> | null = null

  // DOM elements
  logPanel: HTMLElement
  chatPanel: HTMLElement
  connectBtn: HTMLButtonElement
  connIndicator: HTMLElement
  connStatus: HTMLElement
  agentStatus: HTMLElement
  audioLevel: HTMLElement
  turnStatus: HTMLElement

  // Callbacks for speech events
  onSpeechStart?: () => void
  onSpeechEnd?: () => void

  private _audioInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: AgentClientConfig) {
    this.AGENT_ID = config.agentId
    this.AGENT_NAME = config.agentName
    this.SESSION_ENDPOINT = config.sessionEndpoint

    this.socket = io(config.namespace || "/space")

    this.logPanel = document.getElementById("logPanel")!
    this.chatPanel = document.getElementById("chatPanel")!
    this.connectBtn = document.getElementById("connectBtn") as HTMLButtonElement
    this.connIndicator = document.getElementById("connIndicator")!
    this.connStatus = document.getElementById("connStatus")!
    this.agentStatus = document.getElementById("agentStatus")!
    this.audioLevel = document.getElementById("audioLevel")!
    this.turnStatus = document.getElementById("turnStatus")!

    this._setupSocketHandlers()
    this._setupBeforeUnload()
  }

  log(msg: string, type = ""): void {
    const p = document.createElement("p")
    p.className = type
    p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
    this.logPanel.appendChild(p)
    this.logPanel.scrollTop = this.logPanel.scrollHeight
  }

  addChat(name: string, text: string, type = ""): void {
    const div = document.createElement("div")
    div.className = "chat-msg " + type
    div.innerHTML = `<strong>${name}:</strong> ${text}`
    this.chatPanel.appendChild(div)
    this.chatPanel.scrollTop = this.chatPanel.scrollHeight
  }

  setStatus(status: string): void {
    this.agentStatus.textContent = status.charAt(0).toUpperCase() + status.slice(1)
    this.socket.emit("statusChange", { agentId: this.AGENT_ID, status })

    this.connIndicator.className = "status-indicator"
    if (status === "speaking") this.connIndicator.classList.add("speaking")
    else if (status === "listening") this.connIndicator.classList.add("listening")
    else if (this.isConnected) this.connIndicator.classList.add("connected")
  }

  updateTurnUI(): void {
    if (this.hasTurn) {
      this.turnStatus.className = "turn-status my-turn"
      this.turnStatus.textContent = "\u{1F399}\uFE0F Your turn to speak!"
    } else {
      this.turnStatus.className = "turn-status waiting"
      this.turnStatus.textContent = "\u23F3 Waiting for turn..."
    }
  }

  markConnected(): void {
    this.isConnected = true
    this.connIndicator.classList.add("connected")
    this.connStatus.textContent = "Connected"
    this.socket.emit("agentConnect", { agentId: this.AGENT_ID })
    this.setStatus("idle")
    this.connectBtn.textContent = "Connected"
    this.connectBtn.disabled = true
  }

  markDisconnected(): void {
    this.isConnected = false
    this.connIndicator.classList.remove("connected")
    this.connStatus.textContent = "Disconnected"
    this.socket.emit("agentDisconnect", { agentId: this.AGENT_ID })
    this.connectBtn.textContent = "Connect"
    this.connectBtn.disabled = false
  }

  setupAudioAnalysis(stream: MediaStream): void {
    this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
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

      ;(this.audioLevel as HTMLElement).style.width = Math.min(level * 150, 100) + "%"
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

  private _setupSocketHandlers(): void {
    this.socket.on("connect", () => {
      this.log("Socket connected", "success")
    })

    this.socket.on("stateUpdate", (data: { currentTurn: number | null }) => {
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

    this.socket.on("turnGranted", ({ agentId }: { agentId: number }) => {
      if (agentId === this.AGENT_ID) {
        this.hasTurn = true
        this.updateTurnUI()
        this.log("Turn granted!", "success")
      }
    })

    this.socket.on("textComplete", (msg: { agentId: number; name: string; text: string; isUser?: boolean }) => {
      if (msg.agentId !== this.AGENT_ID && msg.agentId >= 0) {
        this.addChat(msg.name, msg.text, "other")
      } else if (msg.isUser) {
        this.addChat(msg.name, msg.text, "user")
      }
    })
  }

  private _setupBeforeUnload(): void {
    window.addEventListener("beforeunload", () => {
      this.socket.emit("agentDisconnect", { agentId: this.AGENT_ID })
    })
  }
}


