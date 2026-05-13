// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§76]

import { io, Socket } from 'socket.io-client'

export interface AgentInfo {
  id: string
  name: string
  status: 'idle' | 'speaking' | 'listening' | 'thinking' | 'offline'
  connected: boolean
}

export interface ChatMessage {
  id: string
  agentId: string | number
  name: string
  text: string
  timestamp: number
  isUser?: boolean
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ConnectionOptions {
  agentId?: string
  roomId?: string
  apiKey?: string
  userName?: string
}

type MessageHandler = (msg: ChatMessage) => void
type AudioHandler = (audio: string, format: string, agentId: string) => void
type StateChangeHandler = (state: ConnectionState) => void
type AgentStatusHandler = (agentId: string, status: string, name: string) => void
type StreamDeltaHandler = (agentId: string, delta: string, messageId: string) => void

export class WidgetConnection {
  private socket: Socket | null = null
  private serverUrl: string
  private options: ConnectionOptions
  private state: ConnectionState = 'disconnected'

  private messageHandlers: MessageHandler[] = []
  private audioHandlers: AudioHandler[] = []
  private stateHandlers: StateChangeHandler[] = []
  private agentStatusHandlers: AgentStatusHandler[] = []
  private streamDeltaHandlers: StreamDeltaHandler[] = []

  private offlineQueue: Array<{ text: string }> = []
  private static readonly MAX_QUEUE_SIZE = 50

  constructor(serverUrl: string, options: ConnectionOptions = {}) {
    this.serverUrl = serverUrl.replace(/\/$/, '')
    this.options = options
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve()
        return
      }

      this._setState('connecting')

      const authHeaders: Record<string, string> = {}
      if (this.options.apiKey) {
        authHeaders['authorization'] = `Bearer ${this.options.apiKey}`
      }

      this.socket = io(`${this.serverUrl}/space`, {
        transports: ['websocket', 'polling'],
        auth: authHeaders,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      })

      const onConnect = () => {
        this._setState('connected')
        // Join room
        this.socket!.emit('joinRoom', { roomId: this.options.roomId || 'default' })
        resolve()
      }

      const onConnectError = (err: Error) => {
        this._setState('error')
        reject(err)
      }

      this.socket.once('connect', onConnect)
      this.socket.once('connect_error', onConnectError)

      this.socket.on('disconnect', () => {
        this._setState('disconnected')
      })

      this.socket.on('reconnect', () => {
        this._setState('connected')
        this.socket!.emit('joinRoom', { roomId: this.options.roomId || 'default' })
        this.flushOfflineQueue()
      })

      this.socket.on('textComplete', (msg: ChatMessage) => {
        this.messageHandlers.forEach(h => h(msg))
      })

      this.socket.on('userMessage', (msg: ChatMessage) => {
        this.messageHandlers.forEach(h => h(msg))
      })

      this.socket.on('messageHistory', (messages: ChatMessage[]) => {
        messages.forEach(msg => this.messageHandlers.forEach(h => h(msg)))
      })

      this.socket.on('ttsAudio', ({ agentId, audio, format }: { agentId: string; audio: string; format: string }) => {
        this.audioHandlers.forEach(h => h(audio, format, agentId))
      })

      this.socket.on('agentStatus', ({ agentId, status, name }: { agentId: string; status: string; name: string }) => {
        this.agentStatusHandlers.forEach(h => h(agentId, status, name))
      })

      this.socket.on('textDelta', ({ agentId, delta, messageId }: { agentId: string; delta: string; messageId: string }) => {
        this.streamDeltaHandlers.forEach(h => h(agentId, delta, messageId))
      })

      this.socket.on('error', (err: { message: string }) => {
        // Surface server errors; connection state unchanged
        console.warn('[XSpaceWidget] Server error:', err.message)
      })
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this._setState('disconnected')
  }

  sendMessage(text: string): void {
    if (!this.socket?.connected) {
      if (this.offlineQueue.length < WidgetConnection.MAX_QUEUE_SIZE) {
        this.offlineQueue.push({ text })
      }
      return
    }
    this.socket.emit('userMessage', {
      text,
      from: this.options.userName || 'User',
    })
  }

  private flushOfflineQueue(): void {
    const queued = this.offlineQueue.splice(0)
    for (const msg of queued) {
      this.sendMessage(msg.text)
    }
  }

  sendAudio(buffer: ArrayBuffer, mimeType = 'audio/webm'): void {
    if (!this.socket?.connected) return
    const agentId = this.options.agentId
    if (!agentId) return

    // Convert ArrayBuffer to base64
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64 = btoa(binary)

    this.socket.emit('audioData', { agentId, audio: base64, mimeType })
  }

  onAgentMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler)
  }

  onAgentAudio(handler: AudioHandler): void {
    this.audioHandlers.push(handler)
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateHandlers.push(handler)
  }

  onAgentStatus(handler: AgentStatusHandler): void {
    this.agentStatusHandlers.push(handler)
  }

  onStreamDelta(handler: StreamDeltaHandler): void {
    this.streamDeltaHandlers.push(handler)
  }

  getState(): ConnectionState {
    return this.state
  }

  private _setState(state: ConnectionState): void {
    this.state = state
    this.stateHandlers.forEach(h => h(state))
  }
}


