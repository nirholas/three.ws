// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import type { ConnectionState, Message } from '../types';

/**
 * Socket.IO client wrapper for the agent-voice-chat server.
 * Connects to the /space namespace.
 */
export class SocketConnection {
  private socket: any = null; // Socket.IO socket instance
  private _state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT = 5;

  // Event callbacks
  onStateChange?: (state: ConnectionState) => void;
  onStateUpdate?: (data: { agents: Record<number, any>; currentTurn: number | null }) => void;
  onMessageHistory?: (messages: Message[]) => void;
  onTextDelta?: (data: { agentId: number; delta: string; messageId: string; name: string }) => void;
  onTextComplete?: (msg: Message) => void;
  onUserMessage?: (msg: Message) => void;
  onAgentStatus?: (data: { agentId: number; status: string; name: string }) => void;
  onTtsAudio?: (data: { agentId: number; audio: string; format: string }) => void;
  onTtsBrowser?: (data: { agentId: number; text: string }) => void;
  onAudioLevel?: (data: { agentId: number; level: number }) => void;
  onError?: (err: Error) => void;

  get state(): ConnectionState {
    return this._state;
  }

  /** Connect to the server's /space namespace */
  async connect(serverUrl: string): Promise<void> {
    this.setState('connecting');

    try {
      // Dynamically load Socket.IO client if not available
      const io = await this.getIO();

      this.socket = io(`${serverUrl}/space`, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.MAX_RECONNECT,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      });

      this.setupListeners();
    } catch (err) {
      this.setState('error');
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Disconnect from server */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.setState('disconnected');
  }

  /** Send a user text message */
  sendUserMessage(text: string, from: string = 'Web User'): void {
    this.socket?.emit('userMessage', { text, from });
  }

  /** Send audio data for transcription */
  sendAudioData(agentId: number, audio: string, mimeType: string): void {
    this.socket?.emit('audioData', { agentId, audio, mimeType });
  }

  /** Send audio level for visualization */
  sendAudioLevel(agentId: number, level: number): void {
    this.socket?.emit('audioLevel', { agentId, level });
  }

  /** Send direct text to a specific agent */
  sendTextToAgent(agentId: number, text: string, from: string = 'Web User'): void {
    this.socket?.emit('textToAgentDirect', { agentId, text, from });
  }

  get connected(): boolean {
    return this._state === 'connected';
  }

  private setupListeners(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      this.reconnectAttempts = 0;
      this.setState('connected');
    });

    this.socket.on('disconnect', () => {
      this.setState('disconnected');
    });

    this.socket.on('connect_error', (err: Error) => {
      this.reconnectAttempts++;
      if (this.reconnectAttempts >= this.MAX_RECONNECT) {
        this.setState('error');
      }
      this.onError?.(err);
    });

    this.socket.on('stateUpdate', (data: any) => {
      this.onStateUpdate?.(data);
    });

    this.socket.on('messageHistory', (messages: Message[]) => {
      this.onMessageHistory?.(messages);
    });

    this.socket.on('textDelta', (data: any) => {
      this.onTextDelta?.(data);
    });

    this.socket.on('textComplete', (msg: Message) => {
      this.onTextComplete?.(msg);
    });

    this.socket.on('userMessage', (msg: Message) => {
      this.onUserMessage?.(msg);
    });

    this.socket.on('agentStatus', (data: any) => {
      this.onAgentStatus?.(data);
    });

    this.socket.on('ttsAudio', (data: any) => {
      this.onTtsAudio?.(data);
    });

    this.socket.on('ttsBrowser', (data: any) => {
      this.onTtsBrowser?.(data);
    });

    this.socket.on('audioLevel', (data: any) => {
      this.onAudioLevel?.(data);
    });
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this.onStateChange?.(state);
  }

  /** Resolve the Socket.IO `io` function from global or dynamic import */
  private async getIO(): Promise<any> {
    // Check global (IIFE scenario where socket.io-client is loaded via CDN)
    if (typeof (globalThis as any).io === 'function') {
      return (globalThis as any).io;
    }

    // Try dynamic import (ESM scenario)
    try {
      const mod = await import('socket.io-client');
      return mod.io || mod.default;
    } catch {
      // Try loading from CDN as last resort
      return this.loadFromCDN();
    }
  }

  /** Load Socket.IO client from CDN */
  private loadFromCDN(): Promise<any> {
    return new Promise((resolve, reject) => {
      // Avoid loading twice
      if (typeof (globalThis as any).io === 'function') {
        return resolve((globalThis as any).io);
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        if (typeof (globalThis as any).io === 'function') {
          resolve((globalThis as any).io);
        } else {
          reject(new Error('Socket.IO failed to load'));
        }
      };
      script.onerror = () => reject(new Error('Failed to load Socket.IO from CDN'));
      document.head.appendChild(script);
    });
  }
}


