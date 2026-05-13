// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { useCallback, useEffect, useRef, useState } from 'react';
import { VoiceChatClient } from '@agent-voice-chat/core';
import type { Message } from '@agent-voice-chat/core';
import type { UseVoiceChatOptions, UseVoiceChatReturn } from './types';

/**
 * React hook for full control over the voice chat lifecycle.
 *
 * @example
 * ```tsx
 * const { connect, disconnect, messages, isConnected } = useVoiceChat({
 *   server: 'http://localhost:3000',
 *   agent: 'bob',
 * });
 * ```
 */
export function useVoiceChat(options: UseVoiceChatOptions): UseVoiceChatReturn {
  const clientRef = useRef<VoiceChatClient | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<Error | null>(null);

  // Stable reference to options for the client
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Create / recreate client when server or agent changes
  useEffect(() => {
    const client = new VoiceChatClient({
      server: options.server,
      agent: options.agent,
      room: options.room,
      agentName: options.agentName,
      pushToTalk: options.pushToTalk,
      speechThreshold: options.speechThreshold,
      silenceDuration: options.silenceDuration,
    });

    client.on('connected', () => {
      setIsConnected(true);
      setError(null);
    });
    client.on('disconnected', () => {
      setIsConnected(false);
      setIsListening(false);
    });
    client.on('message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    client.on('speaking', (val) => setIsSpeaking(val));
    client.on('listening', (val) => setIsListening(val));
    client.on('audioLevel', (val) => setAudioLevel(val));
    client.on('error', (err) => setError(err));

    clientRef.current = client;

    return () => {
      client.destroy();
      clientRef.current = null;
      setIsConnected(false);
      setIsListening(false);
      setIsSpeaking(false);
      setAudioLevel(0);
      setMessages([]);
    };
  }, [options.server, options.agent, options.room]);

  const connect = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      setError(null);
      await client.connect();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  const sendMessage = useCallback((text: string) => {
    clientRef.current?.sendMessage(text);
  }, []);

  const startListening = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      await client.startListening();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  const stopListening = useCallback(() => {
    clientRef.current?.stopListening();
  }, []);

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


