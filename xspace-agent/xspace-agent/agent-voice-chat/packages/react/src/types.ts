// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import type { ClientConfig, Message } from '@agent-voice-chat/core';

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
  /** Called when a message is received */
  onMessage?: (msg: Message) => void;
  /** Called when connected */
  onConnect?: () => void;
  /** Called when disconnected */
  onDisconnect?: () => void;
  /** Called on error */
  onError?: (err: Error) => void;
  /** Additional CSS class name */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
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
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  audioLevel: number;
  messages: Message[];
  error: Error | null;
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
  /** Additional CSS class name */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
}


