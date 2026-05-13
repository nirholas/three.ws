// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import type { ResolvedConfig, Message, AgentStatus, ConnectionState } from '../types';

/** SVG icons */
const ICONS = {
  agent: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>`,
  close: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`,
  micOff: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>`,
  send: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
};

const WAVEFORM_BARS = 24;

export class ChatModal {
  readonly el: HTMLDivElement;
  private modal: HTMLDivElement;
  private headerStatus: HTMLSpanElement;
  private waveformBars: HTMLDivElement[] = [];
  private visualizerLabel: HTMLDivElement;
  private transcript: HTMLDivElement;
  private micBtn: HTMLButtonElement;
  private textInput: HTMLInputElement;
  private sendBtn: HTMLButtonElement;
  private streamingEls: Map<string, HTMLDivElement> = new Map();
  private _isOpen = false;
  private micActive = false;

  // Callbacks set by widget
  onMicToggle?: () => void;
  onSendText?: (text: string) => void;
  onClose?: () => void;

  constructor(private config: ResolvedConfig) {
    // Overlay wrapper
    this.el = document.createElement('div');
    this.el.className = `avc-modal-overlay ${config.position}`;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', `Chat with ${config.agentName}`);
    this.el.style.pointerEvents = 'auto';

    // Build modal structure
    this.modal = document.createElement('div');
    this.modal.className = 'avc-modal';

    // -- Header --
    const header = document.createElement('div');
    header.className = 'avc-header';

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'avc-header-avatar';
    if (config.agentAvatar) {
      const img = document.createElement('img');
      img.src = config.agentAvatar;
      img.alt = config.agentName;
      avatarWrap.appendChild(img);
    } else {
      avatarWrap.innerHTML = ICONS.agent;
    }
    header.appendChild(avatarWrap);

    const info = document.createElement('div');
    info.className = 'avc-header-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'avc-header-name';
    nameEl.textContent = config.agentName;
    this.headerStatus = document.createElement('span');
    this.headerStatus.className = 'avc-header-status';
    this.headerStatus.textContent = 'Connecting...';
    info.appendChild(nameEl);
    info.appendChild(this.headerStatus);
    header.appendChild(info);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'avc-close-btn';
    closeBtn.setAttribute('aria-label', 'Close chat');
    closeBtn.innerHTML = ICONS.close;
    closeBtn.addEventListener('click', () => this.onClose?.());
    header.appendChild(closeBtn);

    this.modal.appendChild(header);

    // -- Visualizer --
    const visualizer = document.createElement('div');
    visualizer.className = 'avc-visualizer';

    const vizInner = document.createElement('div');

    const waveform = document.createElement('div');
    waveform.className = 'avc-waveform';
    for (let i = 0; i < WAVEFORM_BARS; i++) {
      const bar = document.createElement('div');
      bar.className = 'avc-waveform-bar';
      bar.style.animationDelay = `${(i * 0.05).toFixed(2)}s`;
      waveform.appendChild(bar);
      this.waveformBars.push(bar);
    }
    vizInner.appendChild(waveform);

    this.visualizerLabel = document.createElement('div');
    this.visualizerLabel.className = 'avc-visualizer-label';
    this.visualizerLabel.textContent = 'Click the mic to start talking';
    vizInner.appendChild(this.visualizerLabel);

    visualizer.appendChild(vizInner);
    this.modal.appendChild(visualizer);

    // -- Transcript --
    this.transcript = document.createElement('div');
    this.transcript.className = config.showTranscript ? 'avc-transcript' : 'avc-transcript';
    if (!config.showTranscript) {
      this.transcript.style.display = 'none';
    }
    const empty = document.createElement('div');
    empty.className = 'avc-empty-state';
    empty.textContent = 'Conversation will appear here...';
    this.transcript.appendChild(empty);
    this.modal.appendChild(this.transcript);

    // -- Controls --
    const controls = document.createElement('div');
    controls.className = 'avc-controls';

    this.micBtn = document.createElement('button');
    this.micBtn.className = 'avc-mic-btn';
    this.micBtn.setAttribute('aria-label', 'Toggle microphone');
    this.micBtn.innerHTML = ICONS.mic;
    this.micBtn.addEventListener('click', () => this.onMicToggle?.());
    controls.appendChild(this.micBtn);

    this.modal.appendChild(controls);

    // -- Text input row --
    const inputRow = document.createElement('div');
    inputRow.className = 'avc-input-row';

    this.textInput = document.createElement('input');
    this.textInput.type = 'text';
    this.textInput.className = 'avc-text-input';
    this.textInput.placeholder = 'Type a message...';
    this.textInput.setAttribute('aria-label', 'Type a message');
    this.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.textInput.value.trim()) {
        this.sendText();
      }
    });
    inputRow.appendChild(this.textInput);

    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'avc-send-btn';
    this.sendBtn.setAttribute('aria-label', 'Send message');
    this.sendBtn.innerHTML = ICONS.send;
    this.sendBtn.addEventListener('click', () => this.sendText());
    inputRow.appendChild(this.sendBtn);

    this.modal.appendChild(inputRow);

    this.el.appendChild(this.modal);

    // Close on Escape
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.onClose?.();
    });
  }

  private sendText(): void {
    const text = this.textInput.value.trim();
    if (!text) return;
    this.textInput.value = '';
    this.onSendText?.(text);
  }

  /** Open / close modal with animation */
  setOpen(open: boolean): void {
    this._isOpen = open;
    this.el.classList.toggle('open', open);
    if (open) {
      // Focus the text input for keyboard users
      requestAnimationFrame(() => this.textInput.focus());
    }
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  /** Update connection status text */
  setConnectionState(state: ConnectionState): void {
    const labels: Record<ConnectionState, string> = {
      disconnected: 'Disconnected',
      connecting: 'Connecting...',
      connected: 'Online',
      error: 'Connection error',
    };
    this.headerStatus.textContent = labels[state];
    this.micBtn.disabled = state !== 'connected';
  }

  /** Update agent status */
  setAgentStatus(status: AgentStatus): void {
    const labels: Record<AgentStatus, string> = {
      idle: 'Online',
      listening: 'Listening...',
      speaking: 'Speaking...',
      offline: 'Offline',
    };
    this.headerStatus.textContent = labels[status];
  }

  /** Activate/deactivate waveform animation */
  setWaveformActive(active: boolean): void {
    this.waveformBars.forEach((bar) => {
      bar.classList.toggle('active', active);
    });
  }

  /** Update visualizer label text */
  setVisualizerLabel(label: string): void {
    this.visualizerLabel.textContent = label;
  }

  /** Update mic button state */
  setMicActive(active: boolean): void {
    this.micActive = active;
    this.micBtn.classList.toggle('active', active);
    this.micBtn.innerHTML = active ? ICONS.micOff : ICONS.mic;
    this.micBtn.setAttribute('aria-label', active ? 'Mute microphone' : 'Unmute microphone');
    this.setVisualizerLabel(active ? 'Listening...' : 'Click the mic to start talking');
  }

  /** Add a completed message to the transcript */
  addMessage(msg: Message): void {
    if (!this.config.showTranscript) return;

    // Remove empty state
    const empty = this.transcript.querySelector('.avc-empty-state');
    if (empty) empty.remove();

    // Remove streaming element if exists
    if (this.streamingEls.has(msg.id)) {
      this.streamingEls.get(msg.id)!.remove();
      this.streamingEls.delete(msg.id);
    }

    const msgEl = document.createElement('div');
    msgEl.className = `avc-msg ${msg.isUser ? 'user' : 'agent'}`;
    if (!msg.isUser) {
      const nameEl = document.createElement('div');
      nameEl.className = 'avc-msg-name';
      nameEl.textContent = msg.name;
      msgEl.appendChild(nameEl);
    }
    const textEl = document.createElement('span');
    textEl.textContent = msg.text;
    msgEl.appendChild(textEl);

    this.transcript.appendChild(msgEl);
    this.scrollToBottom();
  }

  /** Handle streaming text delta */
  appendDelta(messageId: string, delta: string, agentName: string): void {
    if (!this.config.showTranscript) return;

    // Remove empty state
    const empty = this.transcript.querySelector('.avc-empty-state');
    if (empty) empty.remove();

    let el = this.streamingEls.get(messageId);
    if (!el) {
      el = document.createElement('div');
      el.className = 'avc-msg agent avc-msg-streaming';
      const nameEl = document.createElement('div');
      nameEl.className = 'avc-msg-name';
      nameEl.textContent = agentName;
      el.appendChild(nameEl);
      const textEl = document.createElement('span');
      textEl.className = 'avc-msg-text';
      el.appendChild(textEl);
      this.transcript.appendChild(el);
      this.streamingEls.set(messageId, el);
    }

    const textEl = el.querySelector('.avc-msg-text');
    if (textEl) textEl.textContent += delta;
    this.scrollToBottom();
  }

  /** Load message history */
  loadHistory(messages: Message[]): void {
    if (!this.config.showTranscript) return;
    // Clear transcript
    this.transcript.innerHTML = '';
    if (messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'avc-empty-state';
      empty.textContent = 'Conversation will appear here...';
      this.transcript.appendChild(empty);
      return;
    }
    messages.forEach((msg) => this.addMessage(msg));
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.transcript.scrollTop = this.transcript.scrollHeight;
    });
  }
}


