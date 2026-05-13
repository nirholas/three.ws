// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { ref, onUnmounted, watch, toRefs, reactive } from 'vue';
import { VoiceChatClient } from '@agent-voice-chat/core';
import type { Message } from '@agent-voice-chat/core';
import type { UseVoiceChatOptions, UseVoiceChatReturn } from './types';

/**
 * Vue composable for full control over the voice chat lifecycle.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useVoiceChat } from '@agent-voice-chat/vue'
 *
 * const { connect, disconnect, messages, isConnected } = useVoiceChat({
 *   server: 'http://localhost:3000',
 *   agent: 'bob',
 * })
 * </script>
 * ```
 */
export function useVoiceChat(options: UseVoiceChatOptions): UseVoiceChatReturn {
  const isConnected = ref(false);
  const isListening = ref(false);
  const isSpeaking = ref(false);
  const audioLevel = ref(0);
  const messages = ref<Message[]>([]);
  const error = ref<Error | null>(null);

  let client: VoiceChatClient | null = null;

  function createClient() {
    // Destroy previous client if any
    if (client) {
      client.destroy();
    }

    client = new VoiceChatClient({
      server: options.server,
      agent: options.agent,
      room: options.room,
      agentName: options.agentName,
      pushToTalk: options.pushToTalk,
      speechThreshold: options.speechThreshold,
      silenceDuration: options.silenceDuration,
    });

    client.on('connected', () => {
      isConnected.value = true;
      error.value = null;
    });
    client.on('disconnected', () => {
      isConnected.value = false;
      isListening.value = false;
    });
    client.on('message', (msg) => {
      messages.value = [...messages.value, msg];
    });
    client.on('speaking', (val) => {
      isSpeaking.value = val;
    });
    client.on('listening', (val) => {
      isListening.value = val;
    });
    client.on('audioLevel', (val) => {
      audioLevel.value = val;
    });
    client.on('error', (err) => {
      error.value = err;
    });
  }

  createClient();

  async function connect(): Promise<void> {
    if (!client) return;
    try {
      error.value = null;
      await client.connect();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    }
  }

  function disconnect(): void {
    client?.disconnect();
  }

  function sendMessage(text: string): void {
    client?.sendMessage(text);
  }

  async function startListening(): Promise<void> {
    if (!client) return;
    try {
      await client.startListening();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    }
  }

  function stopListening(): void {
    client?.stopListening();
  }

  onUnmounted(() => {
    if (client) {
      client.destroy();
      client = null;
    }
  });

  return {
    connect,
    disconnect,
    sendMessage,
    startListening,
    stopListening,
    isConnected,
    isListening,
    isSpeaking,
    audioLevel,
    messages,
    error,
  };
}


