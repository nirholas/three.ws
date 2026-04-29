// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import type { Message } from '@agent-voice-chat/core';
import type { Ref } from 'vue';

export interface VoiceChatProps {
  /** WebSocket server URL */
  server: string;
  /** Agent identifier */
  agent: string;
  /** Optional room to join */
  room?: string;
  /** Color theme */
  theme?: 'light' | 'dark';
  /** Agent display name */
  agentName?: string;
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean;
  /** Enable push-to-talk mode */
  pushToTalk?: boolean;
  /** Show transcript panel (default: true) */
  showTranscript?: boolean;
}

export interface UseVoiceChatOptions {
  /** WebSocket server URL */
  server: string;
  /** Agent identifier */
  agent: string;
  /** Optional room to join */
  room?: string;
  /** Agent display name */
  agentName?: string;
  /** Enable push-to-talk mode */
  pushToTalk?: boolean;
  /** VAD speech threshold 0–1 */
  speechThreshold?: number;
  /** Silence duration in ms before stopping recording */
  silenceDuration?: number;
}

export interface UseVoiceChatReturn {
  connect: () => Promise<void>;
  disconnect: () => void;
  sendMessage: (text: string) => void;
  startListening: () => Promise<void>;
  stopListening: () => void;
  isConnected: Ref<boolean>;
  isListening: Ref<boolean>;
  isSpeaking: Ref<boolean>;
  audioLevel: Ref<number>;
  messages: Ref<Message[]>;
  error: Ref<Error | null>;
}

export interface AudioVisualizerProps {
  /** Audio level value 0–1 */
  level: number;
  /** Bar count (default: 20) */
  bars?: number;
  /** Bar width in px (default: 3) */
  barWidth?: number;
  /** Bar gap in px (default: 2) */
  barGap?: number;
  /** Height in px (default: 40) */
  height?: number;
  /** Active bar color (default: '#3b82f6') */
  color?: string;
  /** Inactive bar color (default: '#e5e7eb') */
  inactiveColor?: string;
}


