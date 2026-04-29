// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

import type { Server, Namespace, Socket } from "socket.io";

// ── Agent & Space State ─────────────────────────────────────────────────────

export interface AgentState {
  id: number;
  name: string;
  status: AgentStatus;
  connected: boolean;
  socketId?: string;
}

export type AgentStatus =
  | "offline"
  | "idle"
  | "listening"
  | "speaking"
  | "thinking";

export interface SpaceState {
  agents: Record<number, AgentState>;
  currentTurn: number | null;
  turnQueue: number[];
  messages: SpaceMessage[];
  isProcessing: boolean;
}

export interface SpaceMessage {
  id: string;
  agentId: number;
  name: string;
  text: string;
  timestamp: number;
  isUser?: boolean;
  source?: string;
}

// ── X Space Bot State ───────────────────────────────────────────────────────

export type XSpaceBotStatus =
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
  | "error";

export interface XSpaceBotState {
  status: XSpaceBotStatus;
  spaceUrl: string | null;
  isCapturing: boolean;
}

// ── Provider Interfaces ─────────────────────────────────────────────────────

export interface LLMProvider {
  readonly type: "socket" | "webrtc";
  streamResponse(
    agentId: number,
    userText: string,
    systemPrompt: string,
  ): AsyncGenerator<string, void, unknown>;
  createSession?(
    agentId: number,
    prompts: Record<number, string>,
    voices: Record<number, string>,
  ): Promise<SessionData>;
  clearHistory?(agentId: number): void;
}

export interface SessionData {
  id?: string;
  client_secret?: { value: string };
  [key: string]: unknown;
}

export interface STTProvider {
  transcribe(
    audioBuffer: Buffer,
    mimeType?: string,
  ): Promise<{ text: string }>;
}

export interface TTSProvider {
  synthesize(text: string, agentId?: number): Promise<Buffer | null>;
}

// ── Socket.IO Event Maps ────────────────────────────────────────────────────

export interface ServerToClientEvents {
  stateUpdate: (data: {
    agents: Record<number, AgentState>;
    currentTurn: number | null;
    turnQueue: number[];
  }) => void;
  messageHistory: (messages: SpaceMessage[]) => void;
  agentStatus: (data: {
    agentId: number;
    status: string;
    name: string;
  }) => void;
  turnGranted: (data: { agentId: number }) => void;
  turnResponse: (data: {
    granted: boolean;
    currentTurn: number | null;
  }) => void;
  textDelta: (data: {
    agentId: number;
    delta: string;
    messageId: string;
    name: string;
  }) => void;
  textComplete: (msg: SpaceMessage) => void;
  userMessage: (msg: SpaceMessage) => void;
  textToAgent: (data: { text: string; from: string }) => void;
  ttsAudio: (data: {
    agentId: number;
    audio: string;
    format: string;
  }) => void;
  ttsBrowser: (data: { agentId: number; text: string }) => void;
  audioLevel: (data: { agentId: number; level: number }) => void;
  xSpacesStatus: (data: { status: string }) => void;
  xSpacesError: (data: { error: string }) => void;
  xSpaces2faRequired: (data: Record<string, never>) => void;
  log: (data: { level: string; message: string; timestamp: number }) => void;
}

export interface ClientToServerEvents {
  agentConnect: (data: { agentId: number }) => void;
  agentDisconnect: (data: { agentId: number }) => void;
  statusChange: (data: { agentId: number; status: string }) => void;
  requestTurn: (data: { agentId: number }) => void;
  releaseTurn: (data: { agentId: number }) => void;
  textDelta: (data: {
    agentId: number;
    delta: string;
    messageId: string;
  }) => void;
  textComplete: (data: {
    agentId: number;
    text: string;
    messageId: string;
  }) => void;
  audioData: (data: {
    agentId: number;
    audio: string;
    mimeType?: string;
  }) => void;
  userMessage: (data: { text: string; from?: string }) => void;
  textToAgentDirect: (data: {
    agentId: number;
    text: string;
    from?: string;
  }) => void;
  audioLevel: (data: { agentId: number; level: number }) => void;
  "xspace:start": () => void;
  "xspace:stop": () => void;
  "xspace:join": (data: { spaceUrl: string }) => void;
  "xspace:leave": () => void;
  "xspace:status": () => void;
  "xspace:2fa": (data: { code: string }) => void;
}

export type SpaceNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents
>;
export type SpaceSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
export type SpaceServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ── Browser Types ───────────────────────────────────────────────────────────

export interface BrowserInstance {
  browser: import("puppeteer").Browser;
  page: import("puppeteer").Page;
}

export interface SpaceUIState {
  isLive: boolean;
  hasEnded: boolean;
  isSpeaker: boolean;
  speakerCount: number;
}

// ── Selector Chain ──────────────────────────────────────────────────────────

export interface SelectorChain {
  primary: string;
  fallbacks: string[];
  textOptions: string[];
}


