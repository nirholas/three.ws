// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

import { WidgetConnection, ChatMessage, ConnectionState } from './connection'
import { Theme, ThemeMode, resolveTheme, themeToCSS, watchAutoTheme } from './theme'
import { VoiceInput } from './audio/voice-input'
import { AudioPlayer } from './audio/audio-player'
import { widgetStyles } from './ui/styles'
import { icons } from './ui/icons'

export type { Theme, ThemeMode } from './theme'
export type { ChatMessage, ConnectionState, ConnectionOptions } from './connection'

export type Position = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'

export interface WidgetConfig {
  serverUrl: string
  agentId?: string
  roomId?: string
  position?: Position
  theme?: ThemeMode
  customTheme?: Partial<Theme>
  apiKey?: string
  greeting?: string
  placeholder?: string
  title?: string
  userName?: string
  enableVoice?: boolean
  enableText?: boolean
  persistMessages?: boolean
  onMessage?: (msg: ChatMessage) => void
  onConnect?: () => void
  onDisconnect?: () => void
}

export class XSpaceWidget {
  private config: Required<
    Pick<WidgetConfig, 'position' | 'theme' | 'greeting' | 'placeholder' | 'title' | 'enableVoice' | 'enableText' | 'persistMessages'>
  > &
    WidgetConfig
  private connection: WidgetConnection
  private voiceInput: VoiceInput | null = null
  private audioPlayer: AudioPlayer
  private shadowRoot: ShadowRoot | null = null
  private hostEl: HTMLElement | null = null
  private isOpen = false
  private mounted = false
  private themeCleanup: (() => void) | null = null
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null

  // DOM references
  private panel!: HTMLElement
  private messagesEl!: HTMLElement
  private inputEl!: HTMLTextAreaElement
  private sendBtn!: HTMLButtonElement
  private voiceBtn!: HTMLButtonElement | null
  private fab!: HTMLButtonElement
  private typingEl!: HTMLElement
  private statusBar!: HTMLElement
  private streamingMessages = new Map<string, HTMLElement>()

  constructor(config: WidgetConfig) {
    if (!config.serverUrl) throw new Error('XSpaceWidget: serverUrl is required')

    this.config = {
      position: 'bottom-right',
      theme: 'light',
      greeting: 'Hello! How can I help you?',
      placeholder: 'Type a message...',
      title: 'Chat',
      enableVoice: true,
      enableText: true,
      persistMessages: true,
      ...config,
    }

    this.connection = new WidgetConnection(config.serverUrl, {
      agentId: config.agentId,
      roomId: config.roomId,
      apiKey: config.apiKey,
      userName: config.userName,
    })

    this.audioPlayer = new AudioPlayer()

    if (this.config.enableVoice && VoiceInput.isSupported()) {
      this.voiceInput = new VoiceInput()
    }

    this.setupConnectionHandlers()
  }

  mount(container?: HTMLElement): void {
    if (this.mounted) return

    this.hostEl = document.createElement('div')
    this.hostEl.id = 'xspace-widget-host'
    this.shadowRoot = this.hostEl.attachShadow({ mode: 'open' })

    const theme = resolveTheme(this.config.theme, this.config.customTheme)
    const style = document.createElement('style')
    style.textContent = themeToCSS(theme) + widgetStyles
    this.shadowRoot.appendChild(style)

    this.buildDOM()

    const target = container || document.body
    target.appendChild(this.hostEl)
    this.mounted = true

    // Load persisted messages
    this.loadPersistedMessages()

    // Watch auto theme changes
    if (this.config.theme === 'auto') {
      this.themeCleanup = watchAutoTheme((newTheme) => {
        if (this.shadowRoot) {
          const styleEl = this.shadowRoot.querySelector('style')
          if (styleEl) styleEl.textContent = themeToCSS(newTheme) + widgetStyles
        }
      }, this.config.customTheme)
    }

    // Escape key closes widget
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen) this.close()
    }
    document.addEventListener('keydown', this.escapeHandler)

    // Auto-connect
    this.connection.connect().catch((err) => {
      console.warn('[XSpaceWidget] Connection failed:', err.message)
    })
  }

  unmount(): void {
    if (!this.mounted) return
    this.connection.disconnect()
    this.hostEl?.remove()
    this.hostEl = null
    this.shadowRoot = null
    this.mounted = false
  }

  open(): void {
    if (!this.mounted) return
    this.isOpen = true
    this.panel.classList.add('xw-panel--open')
    this.fab.setAttribute('aria-expanded', 'true')
    this.fab.innerHTML = icons.close
    this.inputEl?.focus()
    this.scrollToBottom()
  }

  close(): void {
    if (!this.mounted) return
    this.isOpen = false
    this.panel.classList.remove('xw-panel--open')
    this.fab.setAttribute('aria-expanded', 'false')
    this.fab.innerHTML = icons.chat
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open()
  }

  sendMessage(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    this.connection.sendMessage(trimmed)
    const msg: ChatMessage = { id: crypto.randomUUID(), text: trimmed, isUser: true, name: this.config.userName || 'You', agentId: '', timestamp: Date.now() }
    this.addMessage(msg)
    this.persistMessage(msg)
  }

  destroy(): void {
    this.unmount()
    this.themeCleanup?.()
    this.themeCleanup = null
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler)
      this.escapeHandler = null
    }
    this.voiceInput?.destroy()
    this.audioPlayer.destroy()
  }

  clearHistory(): void {
    const key = this.persistenceKey()
    if (key) {
      try { localStorage.removeItem(key) } catch {}
    }
  }

  private persistenceKey(): string | null {
    if (!this.config.persistMessages) return null
    return `xspace-widget-${this.config.agentId || 'default'}`
  }

  private persistMessage(msg: ChatMessage): void {
    const key = this.persistenceKey()
    if (!key) return
    try {
      const stored: ChatMessage[] = JSON.parse(localStorage.getItem(key) || '[]')
      stored.push(msg)
      // Keep last 200 messages
      if (stored.length > 200) stored.splice(0, stored.length - 200)
      localStorage.setItem(key, JSON.stringify(stored))
    } catch {}
  }

  private loadPersistedMessages(): void {
    const key = this.persistenceKey()
    if (!key) return
    try {
      const stored: ChatMessage[] = JSON.parse(localStorage.getItem(key) || '[]')
      for (const msg of stored) {
        this.addMessage(msg)
      }
    } catch {}
  }

  isConnected(): boolean {
    return this.connection.getState() === 'connected'
  }

  private setupConnectionHandlers(): void {
    this.connection.onAgentMessage((msg) => {
      // Remove streaming message if exists
      if (this.streamingMessages.has(msg.id)) {
        this.streamingMessages.get(msg.id)!.remove()
        this.streamingMessages.delete(msg.id)
      }
      if (!msg.isUser) {
        this.addMessage(msg)
        this.persistMessage(msg)
      }
      this.config.onMessage?.(msg)
    })

    this.connection.onStreamDelta((agentId, delta, messageId) => {
      this.handleStreamDelta(agentId, delta, messageId)
    })

    this.connection.onAgentAudio((audio, format) => {
      this.audioPlayer.play(audio, format)
    })

    this.connection.onAgentStatus((_agentId, status) => {
      this.setTyping(status === 'thinking' || status === 'speaking')
    })

    this.connection.onStateChange((state) => {
      this.updateConnectionStatus(state)
      if (state === 'connected') this.config.onConnect?.()
      if (state === 'disconnected') this.config.onDisconnect?.()
    })
  }

  private buildDOM(): void {
    if (!this.shadowRoot) return

    const container = document.createElement('div')
    container.className = `xw-container xw-container--${this.config.position}`
    container.setAttribute('role', 'region')
    container.setAttribute('aria-label', 'Chat widget')

    // Panel (appears above fab)
    this.panel = document.createElement('div')
    this.panel.className = 'xw-panel'
    this.panel.setAttribute('role', 'dialog')
    this.panel.setAttribute('aria-label', this.config.title)

    // Header
    const header = document.createElement('div')
    header.className = 'xw-header'
    header.innerHTML = `
      <span class="xw-header__title">${this.escapeHTML(this.config.title)}</span>
      <span class="xw-header__status" aria-live="polite"></span>
      <button class="xw-header__close" aria-label="Close chat">
        ${icons.close}
      </button>
    `
    header.querySelector('.xw-header__close')!.addEventListener('click', () => this.close())
    this.panel.appendChild(header)

    // Status bar
    this.statusBar = document.createElement('div')
    this.statusBar.className = 'xw-status-bar'
    this.statusBar.setAttribute('aria-live', 'polite')
    this.panel.appendChild(this.statusBar)

    // Messages
    this.messagesEl = document.createElement('div')
    this.messagesEl.className = 'xw-messages'
    this.messagesEl.setAttribute('role', 'log')
    this.messagesEl.setAttribute('aria-label', 'Chat messages')
    this.messagesEl.setAttribute('aria-live', 'polite')

    if (this.config.greeting) {
      const greetingEl = document.createElement('div')
      greetingEl.className = 'xw-greeting'
      greetingEl.textContent = this.config.greeting
      this.messagesEl.appendChild(greetingEl)
    }

    // Typing indicator
    this.typingEl = document.createElement('div')
    this.typingEl.className = 'xw-typing'
    this.typingEl.setAttribute('aria-label', 'Agent is typing')
    this.typingEl.innerHTML = `
      <div class="xw-typing__dot"></div>
      <div class="xw-typing__dot"></div>
      <div class="xw-typing__dot"></div>
    `
    this.messagesEl.appendChild(this.typingEl)
    this.panel.appendChild(this.messagesEl)

    // Input area
    if (this.config.enableText || this.config.enableVoice) {
      const inputArea = document.createElement('div')
      inputArea.className = 'xw-input-area'

      if (this.config.enableText) {
        this.inputEl = document.createElement('textarea')
        this.inputEl.className = 'xw-input'
        this.inputEl.placeholder = this.config.placeholder
        this.inputEl.rows = 1
        this.inputEl.setAttribute('aria-label', 'Message input')
        this.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            this.handleSend()
          }
        })
        this.inputEl.addEventListener('input', () => this.autoResizeInput())
        inputArea.appendChild(this.inputEl)
      }

      if (this.config.enableVoice && this.voiceInput) {
        this.voiceBtn = document.createElement('button')
        this.voiceBtn.className = 'xw-voice-btn'
        this.voiceBtn.setAttribute('aria-label', 'Voice input')
        this.voiceBtn.innerHTML = icons.mic
        this.voiceBtn.addEventListener('click', () => this.handleVoiceToggle())

        this.voiceInput.onStateChange((state) => {
          if (!this.voiceBtn) return
          if (state === 'recording') {
            this.voiceBtn.classList.add('xw-voice-btn--recording')
            this.voiceBtn.innerHTML = icons.stop
            this.voiceBtn.setAttribute('aria-label', 'Stop recording')
          } else {
            this.voiceBtn.classList.remove('xw-voice-btn--recording')
            this.voiceBtn.innerHTML = icons.mic
            this.voiceBtn.setAttribute('aria-label', 'Voice input')
          }
        })

        inputArea.appendChild(this.voiceBtn)
      }

      if (this.config.enableText) {
        this.sendBtn = document.createElement('button')
        this.sendBtn.className = 'xw-send-btn'
        this.sendBtn.setAttribute('aria-label', 'Send message')
        this.sendBtn.innerHTML = icons.send
        this.sendBtn.addEventListener('click', () => this.handleSend())
        inputArea.appendChild(this.sendBtn)
      }

      this.panel.appendChild(inputArea)
    }

    container.appendChild(this.panel)

    // FAB
    this.fab = document.createElement('button')
    this.fab.className = 'xw-fab'
    this.fab.setAttribute('aria-label', 'Open chat')
    this.fab.setAttribute('aria-expanded', 'false')
    this.fab.setAttribute('aria-haspopup', 'dialog')
    this.fab.innerHTML = icons.chat
    this.fab.addEventListener('click', () => this.toggle())
    container.appendChild(this.fab)

    this.shadowRoot.appendChild(container)
  }

  private handleSend(): void {
    if (!this.inputEl) return
    const text = this.inputEl.value.trim()
    if (!text) return
    this.sendMessage(text)
    this.inputEl.value = ''
    this.autoResizeInput()
    this.inputEl.focus()
  }

  private async handleVoiceToggle(): Promise<void> {
    if (!this.voiceInput) return

    if (this.voiceInput.isRecording()) {
      const result = await this.voiceInput.stop()
      if (result) {
        this.connection.sendAudio(result.buffer, result.mimeType)
      }
    } else {
      try {
        await this.voiceInput.start()
      } catch (err) {
        console.warn('[XSpaceWidget] Voice input error:', err)
      }
    }
  }

  private addMessage(msg: ChatMessage): void {
    if (!this.messagesEl) return

    const bubble = document.createElement('div')
    bubble.className = `xw-bubble ${msg.isUser ? 'xw-bubble--user' : 'xw-bubble--agent'}`
    bubble.setAttribute('role', 'article')

    if (!msg.isUser && msg.name) {
      const nameEl = document.createElement('div')
      nameEl.className = 'xw-bubble__name'
      nameEl.textContent = msg.name
      bubble.appendChild(nameEl)
    }

    const textEl = document.createElement('div')
    textEl.textContent = msg.text
    bubble.appendChild(textEl)

    const timeEl = document.createElement('div')
    timeEl.className = 'xw-bubble__time'
    timeEl.textContent = this.formatTime(msg.timestamp)
    bubble.appendChild(timeEl)

    // Insert before typing indicator
    this.messagesEl.insertBefore(bubble, this.typingEl)
    this.scrollToBottom()
  }

  private handleStreamDelta(agentId: string, delta: string, messageId: string): void {
    if (!this.messagesEl) return

    let bubble = this.streamingMessages.get(messageId)
    if (!bubble) {
      bubble = document.createElement('div')
      bubble.className = 'xw-bubble xw-bubble--agent'
      bubble.setAttribute('role', 'article')

      const nameEl = document.createElement('div')
      nameEl.className = 'xw-bubble__name'
      nameEl.textContent = agentId
      bubble.appendChild(nameEl)

      const textEl = document.createElement('div')
      textEl.dataset.streamText = 'true'
      bubble.appendChild(textEl)

      this.messagesEl.insertBefore(bubble, this.typingEl)
      this.streamingMessages.set(messageId, bubble)
    }

    const textEl = bubble.querySelector('[data-stream-text]')
    if (textEl) {
      textEl.textContent += delta
    }
    this.scrollToBottom()
  }

  private setTyping(visible: boolean): void {
    if (!this.typingEl) return
    this.typingEl.classList.toggle('xw-typing--visible', visible)
    if (visible) this.scrollToBottom()
  }

  private updateConnectionStatus(state: ConnectionState): void {
    if (!this.statusBar) return
    if (state === 'connecting') {
      this.statusBar.textContent = 'Connecting...'
      this.statusBar.classList.add('xw-status-bar--visible')
    } else if (state === 'error') {
      this.statusBar.textContent = 'Connection error. Retrying...'
      this.statusBar.classList.add('xw-status-bar--visible')
    } else {
      this.statusBar.classList.remove('xw-status-bar--visible')
    }
  }

  private scrollToBottom(): void {
    if (this.messagesEl) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight
    }
  }

  private autoResizeInput(): void {
    if (!this.inputEl) return
    this.inputEl.style.height = 'auto'
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 100) + 'px'
  }

  private formatTime(ts: number): string {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  private escapeHTML(s: string): string {
    const div = document.createElement('div')
    div.textContent = s
    return div.innerHTML
  }
}

export function createWidget(config: WidgetConfig): XSpaceWidget {
  const widget = new XSpaceWidget(config)
  widget.mount()
  return widget
}


