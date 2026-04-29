// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

/** Message from the conversation transcript */
export interface Message {
  id: string;
  agentId?: number;
  name: string;
  text: string;
  timestamp: number;
  isUser?: boolean;
}

/** Client configuration */
export interface ClientConfig {
  /** WebSocket server URL (e.g. "http://localhost:3000") */
  server: string;
  /** Agent identifier to connect as */
  agent: string;
  /** Optional room/namespace override */
  room?: string;
  /** Agent display name override */
  agentName?: string;
  /** Enable push-to-talk instead of VAD (default: false) */
  pushToTalk?: boolean;
  /** VAD speech threshold 0–1 (default: 0.04) */
  speechThreshold?: number;
  /** Silence duration in ms before stopping recording (default: 1200) */
  silenceDuration?: number;
}

/** Connection state */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Agent status from server */
export type AgentStatus = 'idle' | 'listening' | 'speaking' | 'offline';

/** Server state update payload */
export interface StateUpdate {
  agents: Record<string, { id: string; name: string; status: AgentStatus; connected: boolean }>;
  currentTurn: string | null;
  turnQueue: string[];
}

/** Event map for VoiceChatClient */
export interface VoiceChatEvents {
  message: (msg: Message) => void;
  speaking: (isSpeaking: boolean) => void;
  connected: () => void;
  disconnected: () => void;
  error: (err: Error) => void;
  audioLevel: (level: number) => void;
  stateUpdate: (state: StateUpdate) => void;
  listening: (isListening: boolean) => void;
}

export type EventName = keyof VoiceChatEvents;


