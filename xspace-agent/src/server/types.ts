// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§87]

export interface Agent {
  id: number
  name: string
  status: "offline" | "idle" | "listening" | "speaking"
  connected: boolean
  socketId?: string
}

export interface Message {
  id: string
  agentId: number
  name: string
  text: string
  timestamp: number
  isUser?: boolean
  source?: string
}

export interface SpaceState {
  agents: Record<number, Agent>
  currentTurn: number | null
  turnQueue: number[]
  messages: Message[]
  isProcessing: boolean
}

export interface Provider {
  type: "socket" | "webrtc"
  streamResponse?(
    agentId: number,
    userText: string,
    systemPrompt: string,
  ): AsyncGenerator<string, void, unknown>
  createSession?(
    agentId: number,
    prompts: Record<number, string>,
    voices: Record<number, string>,
  ): Promise<unknown>
  clearHistory?(agentId: number): void
}

export interface ServerConfig {
  port: number
  contract: string
  projectName: string
  xLink: string
  githubLink: string
  tokenChain: string
  website: string
  team: string
  avatarUrl1: string
  avatarUrl2: string
  inputChat: boolean
  liveChat: boolean
  tokenAddress: string
}


