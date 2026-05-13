// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import type { WidgetConfig, ResolvedConfig, Message, ThemeOverrides, ConnectionState } from './types';
import { WidgetContainer } from './ui/container';
import { FloatingButton } from './ui/button';
import { ChatModal } from './ui/modal';
import { Microphone } from './audio/microphone';
import { AudioPlayback } from './audio/playback';
import { SocketConnection } from './connection/socket';

/**
 * Main widget class — orchestrates UI, audio, and server connection.
 */
export class AgentVoiceChatWidget {
  private config: ResolvedConfig;
  private container: WidgetContainer;
  private button: FloatingButton;
  private modal: ChatModal;
  private mic: Microphone;
  private playback: AudioPlayback;
  private socket: SocketConnection;
  private micInitialized = false;
  private targetAgentId = 0; // Default to agent 0 (Bob)
  private destroyed = false;

  constructor(userConfig: WidgetConfig) {
    this.config = this.resolveConfig(userConfig);

    // Create UI components
    this.container = new WidgetContainer(this.config);
    this.button = new FloatingButton(this.config, () => this.toggle());
    this.modal = new ChatModal(this.config);

    // Create audio components
    this.mic = new Microphone(this.config.pushToTalk);
    this.playback = new AudioPlayback();

    // Create connection
    this.socket = new SocketConnection();

    // Wire everything together
    this.wireUI();
    this.wireAudio();
    this.wireSocket();
  }

  /** Mount the widget and connect to server */
  async init(): Promise<void> {
    // Mount UI
    this.container.mount();
    this.container.append(this.button.el);
    this.container.append(this.modal.el);

    // Connect to server
    await this.socket.connect(this.config.server);

    // Auto-open if configured
    if (this.config.autoOpen) {
      this.open();
    }
  }

  /** Open the chat modal */
  open(): void {
    this.modal.setOpen(true);
    this.button.setOpen(true);
  }

  /** Close the chat modal */
  close(): void {
    this.modal.setOpen(false);
    this.button.setOpen(false);
  }

  /** Toggle the chat modal */
  toggle(): void {
    if (this.modal.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /** Programmatically send a text message */
  sendMessage(text: string): void {
    this.socket.sendUserMessage(text);
    this.addUserMessage(text);
  }

  /** Tear down the widget completely */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.mic.destroy();
    this.playback.destroy();
    this.socket.disconnect();
    this.container.unmount();
  }

  // ---- Private wiring ----

  private wireUI(): void {
    this.modal.onClose = () => this.close();

    this.modal.onMicToggle = async () => {
      if (this.mic.active) {
        this.mic.stop();
        this.modal.setMicActive(false);
        this.modal.setWaveformActive(false);
      } else {
        await this.ensureMic();
        this.mic.start();
        this.modal.setMicActive(true);
        this.modal.setVisualizerLabel('Listening...');
      }
    };

    this.modal.onSendText = (text) => {
      this.sendMessage(text);
    };
  }

  private wireAudio(): void {
    this.mic.onAudioData = (audio, mimeType) => {
      this.socket.sendAudioData(this.targetAgentId, audio, mimeType);
    };

    this.mic.onAudioLevel = (level) => {
      this.socket.sendAudioLevel(this.targetAgentId, level);
      // Activate waveform when there's meaningful audio
      this.modal.setWaveformActive(level > 0.04);
    };

    this.playback.onPlayStart = () => {
      this.button.setSpeaking(true);
      this.modal.setWaveformActive(true);
      this.modal.setVisualizerLabel(`${this.config.agentName} is speaking...`);
    };

    this.playback.onPlayEnd = () => {
      this.button.setSpeaking(false);
      if (!this.mic.active) {
        this.modal.setWaveformActive(false);
        this.modal.setVisualizerLabel('Click the mic to start talking');
      } else {
        this.modal.setVisualizerLabel('Listening...');
      }
    };
  }

  private wireSocket(): void {
    this.socket.onStateChange = (state: ConnectionState) => {
      this.button.setConnectionState(state);
      this.modal.setConnectionState(state);

      if (state === 'connected') {
        this.config.onConnect?.();
      } else if (state === 'disconnected') {
        this.config.onDisconnect?.();
      } else if (state === 'error') {
        this.config.onError?.(new Error('Connection failed'));
      }
    };

    this.socket.onStateUpdate = (data) => {
      // Resolve target agent ID from agent name
      if (data.agents) {
        for (const [id, agent] of Object.entries(data.agents)) {
          if ((agent as any).name?.toLowerCase() === this.config.agent.toLowerCase()) {
            this.targetAgentId = Number(id);
            break;
          }
        }
      }
    };

    this.socket.onMessageHistory = (messages) => {
      this.modal.loadHistory(messages);
    };

    this.socket.onTextDelta = (data) => {
      const agentName = data.name || this.config.agentName;
      this.modal.appendDelta(data.messageId, data.delta, agentName);
    };

    this.socket.onTextComplete = (msg) => {
      this.modal.addMessage(msg);
      this.config.onMessage?.(msg);
    };

    this.socket.onUserMessage = (msg) => {
      this.modal.addMessage(msg);
      this.config.onMessage?.(msg);
    };

    this.socket.onAgentStatus = (data) => {
      if (data.agentId === this.targetAgentId) {
        this.modal.setAgentStatus(data.status as any);
        this.button.setSpeaking(data.status === 'speaking');
      }
    };

    this.socket.onTtsAudio = (data) => {
      if (data.agentId === this.targetAgentId || data.agentId === undefined) {
        this.playback.enqueue(data.audio, data.format || 'audio/mp3');
      }
    };

    this.socket.onTtsBrowser = (data) => {
      if (data.agentId === this.targetAgentId || data.agentId === undefined) {
        this.playback.speakText(data.text);
      }
    };

    this.socket.onError = (err) => {
      this.config.onError?.(err);
    };
  }

  private async ensureMic(): Promise<void> {
    if (this.micInitialized) return;
    try {
      await this.mic.init();
      this.micInitialized = true;
    } catch (err) {
      this.config.onError?.(
        new Error('Microphone access denied. Please allow microphone access to use voice chat.'),
      );
      throw err;
    }
  }

  private addUserMessage(text: string): void {
    const msg: Message = {
      id: `user-${Date.now()}`,
      name: 'You',
      text,
      timestamp: Date.now(),
      isUser: true,
    };
    this.modal.addMessage(msg);
    this.config.onMessage?.(msg);
  }

  /** Merge user config with defaults */
  private resolveConfig(user: WidgetConfig): ResolvedConfig {
    let theme: 'light' | 'dark' = 'dark';
    let themeOverrides: ThemeOverrides = {};

    if (user.theme === 'light' || user.theme === 'dark') {
      theme = user.theme;
    } else if (typeof user.theme === 'object' && user.theme !== null) {
      themeOverrides = user.theme;
    }

    return {
      server: user.server,
      agent: user.agent,
      room: user.room,
      theme,
      themeOverrides,
      position: user.position ?? 'bottom-right',
      buttonSize: user.buttonSize ?? 56,
      modalWidth: user.modalWidth ?? 380,
      autoOpen: user.autoOpen ?? false,
      pushToTalk: user.pushToTalk ?? false,
      showTranscript: user.showTranscript ?? true,
      locale: user.locale ?? 'en',
      agentName: user.agentName ?? user.agent.charAt(0).toUpperCase() + user.agent.slice(1),
      agentAvatar: user.agentAvatar,
      onConnect: user.onConnect,
      onDisconnect: user.onDisconnect,
      onMessage: user.onMessage,
      onError: user.onError,
    };
  }
}


