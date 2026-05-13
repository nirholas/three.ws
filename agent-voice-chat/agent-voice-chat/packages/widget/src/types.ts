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

/** Custom theme overrides */
export interface ThemeOverrides {
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  borderRadius?: string;
}

/** Widget configuration */
export interface WidgetConfig {
  /** Required: WebSocket server URL */
  server: string;
  /** Required: agent identifier */
  agent: string;
  /** Optional: specific room to join */
  room?: string;
  /** Color theme — 'light', 'dark', or custom overrides */
  theme?: 'light' | 'dark' | ThemeOverrides;
  /** Button position on the page */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Floating button diameter in px */
  buttonSize?: number;
  /** Modal width in px */
  modalWidth?: number;
  /** Open modal automatically on load */
  autoOpen?: boolean;
  /** Use push-to-talk instead of voice activity detection */
  pushToTalk?: boolean;
  /** Show text transcript in modal */
  showTranscript?: boolean;
  /** Locale for i18n (reserved for future use) */
  locale?: string;
  /** Agent display name override */
  agentName?: string;
  /** Agent avatar URL */
  agentAvatar?: string;
  /** Called when socket connects */
  onConnect?: () => void;
  /** Called when socket disconnects */
  onDisconnect?: () => void;
  /** Called on each message */
  onMessage?: (msg: Message) => void;
  /** Called on error */
  onError?: (err: Error) => void;
}

/** Resolved internal config with defaults applied */
export interface ResolvedConfig extends Required<Pick<WidgetConfig,
  'server' | 'agent' | 'position' | 'buttonSize' | 'modalWidth' |
  'autoOpen' | 'pushToTalk' | 'showTranscript'
>> {
  room?: string;
  theme: 'light' | 'dark';
  themeOverrides: ThemeOverrides;
  locale: string;
  agentName: string;
  agentAvatar?: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onMessage?: (msg: Message) => void;
  onError?: (err: Error) => void;
}

/** Connection state */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Agent status from server */
export type AgentStatus = 'idle' | 'listening' | 'speaking' | 'offline';

/** Internal events emitted within the widget */
export interface WidgetEvents {
  'connection:change': ConnectionState;
  'agent:status': { agentId: number; status: AgentStatus; name: string };
  'message': Message;
  'message:delta': { agentId: number; delta: string; messageId: string };
  'audio:play': { audio: string; format: string };
  'audio:tts-browser': { text: string };
  'state:update': { agents: Record<number, unknown>; currentTurn: number | null };
}


