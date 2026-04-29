// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import { io, Socket } from 'socket.io-client';
import { AudioManager } from './AudioManager';
import type {
  ClientConfig,
  ConnectionState,
  EventName,
  Message,
  StateUpdate,
  VoiceChatEvents,
} from './types';

/**
 * VoiceChatClient manages the full voice chat lifecycle:
 * Socket.IO connection, audio capture/playback, and message state.
 */
export class VoiceChatClient {
  private socket: Socket | null = null;
  private audio: AudioManager;
  private config: ClientConfig;
  private listeners = new Map<EventName, Set<(...args: any[]) => void>>();
  private _messages: Message[] = [];
  private _connectionState: ConnectionState = 'disconnected';
  private _isListening = false;
  private _isSpeaking = false;
  private _audioLevel = 0;

  constructor(config: ClientConfig) {
    this.config = config;
    this.audio = new AudioManager({
      speechThreshold: config.speechThreshold,
      silenceDuration: config.silenceDuration,
      pushToTalk: config.pushToTalk,
    });

    this.audio.onAudioData = (base64, mimeType) => {
      this.socket?.emit('audioData', {
        agentId: this.config.agent,
        audio: base64,
        mimeType,
      });
    };

    this.audio.onAudioLevel = (level) => {
      this._audioLevel = level;
      this.socket?.emit('audioLevel', { agentId: this.config.agent, level });
      this.emit('audioLevel', level);
    };

    this.audio.onSpeakingChange = (speaking) => {
      if (speaking) {
        this.socket?.emit('statusChange', { agentId: this.config.agent, status: 'listening' });
      } else {
        this.socket?.emit('statusChange', { agentId: this.config.agent, status: 'idle' });
      }
    };

    this.audio.onPlaybackStateChange = (isPlaying) => {
      this._isSpeaking = isPlaying;
      this.emit('speaking', isPlaying);
      if (isPlaying) {
        this.socket?.emit('statusChange', { agentId: this.config.agent, status: 'speaking' });
      } else {
        this.socket?.emit('statusChange', { agentId: this.config.agent, status: 'idle' });
      }
    };
  }

  /** Connect to the voice chat server */
  async connect(): Promise<void> {
    if (this._connectionState === 'connected' || this._connectionState === 'connecting') return;

    this._connectionState = 'connecting';

    return new Promise<void>((resolve, reject) => {
      const namespace = this.config.room
        ? `${this.config.server}/${this.config.room}`
        : `${this.config.server}/space`;

      this.socket = io(namespace, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.socket?.disconnect();
        this._connectionState = 'error';
        this.emit('error', new Error('Connection timeout'));
      }, 10000);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this._connectionState = 'connected';

        this.socket!.emit('agentConnect', { agentId: this.config.agent });
        this.emit('connected');
        resolve();
      });

      this.socket.on('disconnect', () => {
        this._connectionState = 'disconnected';
        this.emit('disconnected');
      });

      this.socket.on('connect_error', (err) => {
        if (this._connectionState === 'connecting') {
          clearTimeout(timeout);
          this._connectionState = 'error';
          this.emit('error', err);
          reject(err);
        }
      });

      this.setupSocketListeners();
    });
  }

  /** Disconnect from the server and release resources */
  disconnect(): void {
    if (this.socket) {
      this.socket.emit('agentDisconnect', { agentId: this.config.agent });
      this.socket.disconnect();
      this.socket = null;
    }
    this.audio.stopCapture();
    this._connectionState = 'disconnected';
    this._isListening = false;
    this.emit('disconnected');
    this.emit('listening', false);
  }

  /** Send a text message to the agent */
  sendMessage(text: string): void {
    if (!this.socket || this._connectionState !== 'connected') return;

    this.socket.emit('userMessage', {
      text,
      from: this.config.agentName || 'User',
    });
  }

  /** Start microphone capture and listening */
  async startListening(): Promise<void> {
    if (this._isListening) return;
    await this.audio.startCapture();
    this._isListening = true;
    this.emit('listening', true);
  }

  /** Stop microphone capture */
  stopListening(): void {
    if (!this._isListening) return;
    this.audio.stopCapture();
    this._isListening = false;
    this.emit('listening', false);
  }

  /** Register an event handler */
  on<E extends EventName>(event: E, handler: VoiceChatEvents[E]): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  /** Remove an event handler */
  off<E extends EventName>(event: E, handler: VoiceChatEvents[E]): void {
    this.listeners.get(event)?.delete(handler);
  }

  /** Current connection state */
  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  get isConnected(): boolean {
    return this._connectionState === 'connected';
  }

  get isListening(): boolean {
    return this._isListening;
  }

  get isSpeaking(): boolean {
    return this._isSpeaking;
  }

  get audioLevel(): number {
    return this._audioLevel;
  }

  get messages(): Message[] {
    return this._messages;
  }

  /** Fully destroy the client and release all resources */
  destroy(): void {
    this.disconnect();
    this.audio.destroy();
    this.listeners.clear();
    this._messages = [];
  }

  // --- Private ---

  private emit<E extends EventName>(event: E, ...args: Parameters<VoiceChatEvents[E]>): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        (handler as (...a: any[]) => void)(...args);
      } catch {
        // swallow handler errors
      }
    }
  }

  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.on('messageHistory', (msgs: Message[]) => {
      this._messages = msgs;
      for (const msg of msgs) {
        this.emit('message', msg);
      }
    });

    this.socket.on('textComplete', (msg: Message) => {
      this._messages.push(msg);
      this.emit('message', msg);
    });

    this.socket.on('stateUpdate', (state: StateUpdate) => {
      this.emit('stateUpdate', state);
    });

    this.socket.on('ttsAudio', ({ agentId, audio }: { agentId: string; audio: string }) => {
      if (agentId === this.config.agent) {
        this.audio.playAudio(audio).catch((err) => {
          this.emit('error', new Error(`Audio playback failed: ${err.message}`));
        });
      }
    });

    this.socket.on('ttsBrowser', ({ agentId, text }: { agentId: string; text: string }) => {
      if (agentId === this.config.agent) {
        this.audio.playBrowserTTS(text);
      }
    });

    this.socket.on('agentStatus', ({ agentId, status }: { agentId: string; status: string }) => {
      if (agentId === this.config.agent && status === 'speaking') {
        this._isSpeaking = true;
        this.emit('speaking', true);
      } else if (agentId === this.config.agent && status !== 'speaking') {
        this._isSpeaking = false;
        this.emit('speaking', false);
      }
    });
  }
}
