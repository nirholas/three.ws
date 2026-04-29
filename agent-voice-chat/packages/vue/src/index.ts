// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import VoiceChat from './VoiceChat.vue';
import AudioVisualizer from './AudioVisualizer.vue';

export { VoiceChat, AudioVisualizer };
export { useVoiceChat } from './useVoiceChat';
export type {
  VoiceChatProps,
  UseVoiceChatOptions,
  UseVoiceChatReturn,
  AudioVisualizerProps,
} from './types';

// Re-export core types for convenience
export type { Message, ClientConfig, ConnectionState } from '@agent-voice-chat/core';
