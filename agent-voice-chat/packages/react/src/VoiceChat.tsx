// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceChat } from './useVoiceChat';
import { AudioVisualizer } from './AudioVisualizer';
import type { VoiceChatProps } from './types';

const DARK_THEME = {
  bg: '#1a1a2e',
  surface: '#16213e',
  text: '#e0e0e0',
  textMuted: '#8888aa',
  primary: '#3b82f6',
  border: '#2a2a4a',
  msgBg: '#1e293b',
  msgUserBg: '#1e3a5f',
};

const LIGHT_THEME = {
  bg: '#ffffff',
  surface: '#f8fafc',
  text: '#1e293b',
  textMuted: '#64748b',
  primary: '#3b82f6',
  border: '#e2e8f0',
  msgBg: '#f1f5f9',
  msgUserBg: '#dbeafe',
};

/**
 * Drop-in voice chat component with built-in UI.
 *
 * @example
 * ```tsx
 * <VoiceChat
 *   server="http://localhost:3000"
 *   agent="bob"
 *   theme="dark"
 *   onMessage={(msg) => console.log(msg)}
 * />
 * ```
 */
export const VoiceChat: React.FC<VoiceChatProps> = ({
  server,
  agent,
  room,
  theme = 'dark',
  agentName,
  autoConnect = true,
  pushToTalk = false,
  showTranscript = true,
  onMessage,
  onConnect,
  onDisconnect,
  onError,
  className,
  style,
}) => {
  const {
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
  } = useVoiceChat({ server, agent, room, agentName, pushToTalk });

  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const colors = theme === 'dark' ? DARK_THEME : LIGHT_THEME;

  // Fire callback events
  useEffect(() => {
    if (isConnected) onConnect?.();
    else if (!isConnected) onDisconnect?.();
  }, [isConnected]);

  useEffect(() => {
    if (error) onError?.(error);
  }, [error]);

  useEffect(() => {
    if (messages.length > 0) {
      onMessage?.(messages[messages.length - 1]);
    }
  }, [messages.length]);

  // Auto-connect
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
  }, [autoConnect, connect]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    sendMessage(text);
    setInputText('');
  }, [inputText, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxWidth: 480,
        height: 600,
        borderRadius: 12,
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: 14,
        backgroundColor: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        ...style,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: `1px solid ${colors.border}`,
          backgroundColor: colors.surface,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: isConnected ? '#22c55e' : '#ef4444',
            }}
          />
          <span style={{ fontWeight: 600 }}>
            {agentName || agent}
          </span>
          {isSpeaking && (
            <span style={{ fontSize: 12, color: colors.primary }}>Speaking...</span>
          )}
        </div>
        <button
          onClick={isConnected ? disconnect : connect}
          style={{
            padding: '4px 12px',
            borderRadius: 6,
            border: 'none',
            backgroundColor: isConnected ? '#ef4444' : colors.primary,
            color: '#fff',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          {isConnected ? 'Disconnect' : 'Connect'}
        </button>
      </div>

      {/* Messages */}
      {showTranscript && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                backgroundColor: msg.isUser ? colors.msgUserBg : colors.msgBg,
                alignSelf: msg.isUser ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
              }}
            >
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 2 }}>
                {msg.name}
              </div>
              <div>{msg.text}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Audio visualizer + mic controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '8px 16px',
          borderTop: `1px solid ${colors.border}`,
          backgroundColor: colors.surface,
        }}
      >
        <button
          onClick={isListening ? stopListening : startListening}
          disabled={!isConnected}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: 'none',
            backgroundColor: isListening ? '#ef4444' : colors.primary,
            color: '#fff',
            cursor: isConnected ? 'pointer' : 'not-allowed',
            opacity: isConnected ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            flexShrink: 0,
          }}
          title={isListening ? 'Stop microphone' : 'Start microphone'}
        >
          {isListening ? '\u23F9' : '\uD83C\uDF99'}
        </button>
        <AudioVisualizer
          level={audioLevel}
          bars={24}
          height={32}
          color={colors.primary}
          inactiveColor={colors.border}
        />
      </div>

      {/* Text input */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '8px 12px',
          borderTop: `1px solid ${colors.border}`,
          backgroundColor: colors.surface,
        }}
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={!isConnected}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.bg,
            color: colors.text,
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!isConnected || !inputText.trim()}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            backgroundColor: colors.primary,
            color: '#fff',
            cursor: isConnected && inputText.trim() ? 'pointer' : 'not-allowed',
            opacity: isConnected && inputText.trim() ? 1 : 0.5,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};

VoiceChat.displayName = 'VoiceChat';
