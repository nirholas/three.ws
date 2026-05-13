// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { EventEmitter } from "events"

// === Agent Configuration ===

export interface AgentConfig {
  auth: AuthConfig
  ai: AIConfig
  voice?: VoiceConfig
  browser?: BrowserConfig
  behavior?: BehaviorConfig
}

export interface AuthConfig {
  /** X auth_token cookie value */
  token?: string
  /** X ct0 CSRF token */
  ct0?: string
  /** Username for form-based login */
  username?: string
  /** Password for form-based login */
  password?: string
  /** Email for verification step */
  email?: string
  /** Path to persistent cookie file */
  cookiePath?: string
}

export interface AIConfig {
  provider: "openai" | "openai-realtime" | "openai-chat" | "claude" | "groq" | "custom"
  model?: string
  apiKey?: string
  systemPrompt: string
  maxTokens?: number
  temperature?: number
  maxHistory?: number
  custom?: CustomProvider
}

export interface VoiceConfig {
  provider: "elevenlabs" | "openai" | "browser"
  apiKey?: string
  voiceId?: string
  speed?: number
  stability?: number
}

export interface BrowserConfig {
  headless?: boolean
  executablePath?: string
  userDataDir?: string
  proxy?: string
  args?: string[]
}

export interface BehaviorConfig {
  autoRespond?: boolean
  silenceThreshold?: number
  minSpeechDuration?: number
  maxResponseLength?: number
  turnDelay?: number
}

// === Agent Status ===

export type AgentStatus =
  | "disconnected"
  | "launching"
  | "logging-in"
  | "logged-in"
  | "joining-space"
  | "in-space-as-listener"
  | "requesting-speaker"
  | "speaker-requested"
  | "speaker"
  | "speaking"
  | "speaking-in-space"
  | "left-space"
  | "space-ended"
  | "listening"
  | "idle"
  | "offline"
  | "error"

// === Messages ===

export interface Message {
  role: "system" | "user" | "assistant"
  content: string
}

export interface SpaceMessage {
  id: string
  agentId: number
  name: string
  text: string
  timestamp: number
  isUser?: boolean
  source?: string
}

// === Events ===

export interface AgentEvents {
  transcription: { text: string; timestamp: number }
  status: AgentStatus
  error: string
  "2fa-required": Record<string, never>
  "2fa-code": string
}

// === Provider Interfaces ===

export type ProviderType = "socket" | "webrtc"

export interface SocketProvider {
  readonly type: "socket"
  streamResponse(
    agentId: number,
    userText: string,
    systemPrompt: string
  ): AsyncGenerator<string, void, unknown>
  clearHistory?(agentId: number): void
}

export interface WebRTCProvider {
  readonly type: "webrtc"
  createSession(
    agentId: number,
    prompts: Record<number, string>,
    voices: Record<number, string>
  ): Promise<unknown>
}

export type LLMProvider = SocketProvider | WebRTCProvider

export interface STTResult {
  text: string
}

export interface STTProvider {
  transcribe(audio: Buffer, mimeType?: string): Promise<STTResult>
  STT_PROVIDER: string
}

export interface TTSProvider {
  synthesize(text: string, agentId?: number): Promise<Buffer | null>
  TTS_PROVIDER: string
  voiceMap: Record<number, string>
}

// === Custom Provider (user-facing) ===

export interface CustomProvider {
  type: "socket"
  generateResponse(params: {
    messages: Message[]
    systemPrompt: string
  }): Promise<string>
  generateResponseStream?(params: {
    messages: Message[]
    systemPrompt: string
  }): AsyncIterable<string>
}

// === Space State ===

export interface AgentState {
  id: number
  name: string
  status: string
  connected: boolean
  socketId?: string
}

export interface SpaceState {
  agents: Record<number, AgentState>
  currentTurn: number | null
  turnQueue: number[]
  messages: SpaceMessage[]
  isProcessing: boolean
}

// === Typed Event Emitter ===

export class TypedEmitter<Events extends Record<string, unknown>> {
  private emitter = new EventEmitter()

  on<K extends keyof Events>(event: K, listener: (data: Events[K]) => void): this {
    this.emitter.on(event as string, listener as (...args: unknown[]) => void)
    return this
  }

  once<K extends keyof Events>(event: K, listener: (data: Events[K]) => void): this {
    this.emitter.once(event as string, listener as (...args: unknown[]) => void)
    return this
  }

  emit<K extends keyof Events>(event: K, data: Events[K]): boolean {
    return this.emitter.emit(event as string, data)
  }

  off<K extends keyof Events>(event: K, listener: (data: Events[K]) => void): this {
    this.emitter.off(event as string, listener as (...args: unknown[]) => void)
    return this
  }
}


