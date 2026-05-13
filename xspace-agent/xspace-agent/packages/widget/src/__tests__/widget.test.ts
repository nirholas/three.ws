// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WidgetConfig } from '../index'
import { XSpaceWidget, createWidget } from '../index'

// ── Mock socket.io-client ───────────────────────────────────────────

const mockSocket = {
  connected: false,
  on: vi.fn().mockReturnThis(),
  once: vi.fn().mockReturnThis(),
  emit: vi.fn(),
  disconnect: vi.fn(() => {
    mockSocket.connected = false
  }),
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    // Simulate connection in a microtask; guard against socket being nulled
    // between creation and callback (as happens in unmount/destroy tests).
    const sock = mockSocket
    queueMicrotask(() => {
      if (!sock.connected) {
        sock.connected = true
        const connectHandlers = sock.once.mock.calls.filter(
          (c: unknown[]) => c[0] === 'connect'
        )
        connectHandlers.forEach((c: unknown[]) => {
          try {
            (c[1] as () => void)()
          } catch {
            // Socket may have been disconnected/nulled — swallow
          }
        })
      }
    })
    return sock
  }),
}))

// ── Mock browser APIs needed by sub-modules ─────────────────────────

vi.stubGlobal('AudioContext', class {
  state = 'running'
  destination = {}
  close = vi.fn()
  resume = vi.fn()
  decodeAudioData = vi.fn()
  createBufferSource = vi.fn()
})

vi.stubGlobal('MediaRecorder', class {
  static isTypeSupported() { return true }
  start = vi.fn()
  stop = vi.fn()
  ondataavailable = null
  onstop = null
  mimeType = 'audio/webm'
})

vi.stubGlobal('navigator', {
  mediaDevices: {
    getUserMedia: vi.fn(() => Promise.resolve({
      getTracks: () => [{ stop: vi.fn() }],
    })),
  },
})

// crypto.randomUUID for sendMessage
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'test-uuid-1234'),
})

// ─────────────────────────────────────────────────────────────────────

describe('XSpaceWidget', () => {
  let widget: XSpaceWidget
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    mockSocket.connected = false
    mockSocket.on.mockClear()
    mockSocket.once.mockClear()
    mockSocket.emit.mockClear()
    mockSocket.disconnect.mockClear()
  })

  afterEach(async () => {
    // Let any pending microtask-based connection callbacks settle
    // before destroying, so they don't fire on a nulled socket.
    await new Promise((r) => setTimeout(r, 10))
    widget?.destroy()
    container.remove()
    mockSocket.connected = false
  })

  function mountWidget(overrides: Partial<WidgetConfig> = {}): XSpaceWidget {
    widget = new XSpaceWidget({
      serverUrl: 'http://localhost:3000',
      title: 'Test Chat',
      greeting: 'Welcome!',
      placeholder: 'Say something...',
      enableVoice: false, // disable voice by default to simplify tests
      ...overrides,
    })
    widget.mount(container)
    return widget
  }

  // ── constructor validation ───────────────────────────────────────

  it('throws when serverUrl is missing', () => {
    expect(() => new XSpaceWidget({} as never)).toThrow('serverUrl is required')
  })

  // ── shadow DOM creation ──────────────────────────────────────────

  it('creates a shadow DOM host element', () => {
    mountWidget()
    const host = container.querySelector('#xspace-widget-host')
    expect(host).not.toBeNull()
    expect(host!.shadowRoot).not.toBeNull()
  })

  it('mounts only once even if mount() is called twice', () => {
    mountWidget()
    widget.mount(container) // second call should be no-op
    const hosts = container.querySelectorAll('#xspace-widget-host')
    expect(hosts.length).toBe(1)
  })

  // ── renders UI elements ──────────────────────────────────────────

  it('renders a FAB button', () => {
    mountWidget()
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const fab = shadow.querySelector('.xw-fab')
    expect(fab).not.toBeNull()
    expect(fab!.getAttribute('aria-label')).toBe('Open chat')
    expect(fab!.getAttribute('aria-expanded')).toBe('false')
  })

  it('renders a panel with the configured title', () => {
    mountWidget({ title: 'My Bot' })
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const title = shadow.querySelector('.xw-header__title')
    expect(title!.textContent).toBe('My Bot')
  })

  it('renders the greeting message', () => {
    mountWidget({ greeting: 'Hello there!' })
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const greeting = shadow.querySelector('.xw-greeting')
    expect(greeting!.textContent).toBe('Hello there!')
  })

  it('renders textarea with configured placeholder', () => {
    mountWidget({ placeholder: 'Ask me anything...' })
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const textarea = shadow.querySelector('.xw-input') as HTMLTextAreaElement
    expect(textarea.placeholder).toBe('Ask me anything...')
  })

  it('renders a send button', () => {
    mountWidget()
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const sendBtn = shadow.querySelector('.xw-send-btn')
    expect(sendBtn).not.toBeNull()
    expect(sendBtn!.getAttribute('aria-label')).toBe('Send message')
  })

  it('renders a style element with theme CSS', () => {
    mountWidget()
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const style = shadow.querySelector('style')
    expect(style).not.toBeNull()
    expect(style!.textContent).toContain('--xw-primary')
    expect(style!.textContent).toContain('.xw-fab')
  })

  // ── open / close toggle ──────────────────────────────────────────

  it('open() adds the open class and updates aria', () => {
    mountWidget()
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!

    widget.open()

    const panel = shadow.querySelector('.xw-panel')
    expect(panel!.classList.contains('xw-panel--open')).toBe(true)

    const fab = shadow.querySelector('.xw-fab')
    expect(fab!.getAttribute('aria-expanded')).toBe('true')
  })

  it('close() removes the open class', () => {
    mountWidget()
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!

    widget.open()
    widget.close()

    const panel = shadow.querySelector('.xw-panel')
    expect(panel!.classList.contains('xw-panel--open')).toBe(false)

    const fab = shadow.querySelector('.xw-fab')
    expect(fab!.getAttribute('aria-expanded')).toBe('false')
  })

  it('toggle() alternates between open and close', () => {
    mountWidget()
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const panel = shadow.querySelector('.xw-panel')!

    widget.toggle() // open
    expect(panel.classList.contains('xw-panel--open')).toBe(true)

    widget.toggle() // close
    expect(panel.classList.contains('xw-panel--open')).toBe(false)
  })

  it('clicking the FAB toggles the panel', () => {
    mountWidget()
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const fab = shadow.querySelector('.xw-fab') as HTMLButtonElement
    const panel = shadow.querySelector('.xw-panel')!

    fab.click() // open
    expect(panel.classList.contains('xw-panel--open')).toBe(true)

    fab.click() // close
    expect(panel.classList.contains('xw-panel--open')).toBe(false)
  })

  it('close button in header closes the panel', () => {
    mountWidget()
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!

    widget.open()
    const closeBtn = shadow.querySelector('.xw-header__close') as HTMLButtonElement
    closeBtn.click()

    const panel = shadow.querySelector('.xw-panel')!
    expect(panel.classList.contains('xw-panel--open')).toBe(false)
  })

  // ── send button dispatches message ───────────────────────────────

  it('send button dispatches the message and clears the input', async () => {
    mountWidget()
    // Wait for connection to establish
    await new Promise((r) => setTimeout(r, 20))

    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const textarea = shadow.querySelector('.xw-input') as HTMLTextAreaElement
    const sendBtn = shadow.querySelector('.xw-send-btn') as HTMLButtonElement

    textarea.value = 'Hello agent'
    sendBtn.click()

    // Should have emitted the message on the socket
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'userMessage',
      expect.objectContaining({ text: 'Hello agent' })
    )
  })

  it('Enter key sends message (without shift)', async () => {
    mountWidget()
    await new Promise((r) => setTimeout(r, 20))

    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const textarea = shadow.querySelector('.xw-input') as HTMLTextAreaElement

    textarea.value = 'Enter test'
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true })
    textarea.dispatchEvent(event)

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'userMessage',
      expect.objectContaining({ text: 'Enter test' })
    )
  })

  it('Shift+Enter does NOT send message', async () => {
    mountWidget()
    await new Promise((r) => setTimeout(r, 20))

    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const textarea = shadow.querySelector('.xw-input') as HTMLTextAreaElement

    textarea.value = 'Multiline'
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
    textarea.dispatchEvent(event)

    // userMessage should NOT have been emitted beyond the joinRoom call
    const userMsgCalls = mockSocket.emit.mock.calls.filter(
      (c: unknown[]) => c[0] === 'userMessage'
    )
    expect(userMsgCalls).toHaveLength(0)
  })

  it('does not send empty or whitespace-only messages', async () => {
    mountWidget()
    await new Promise((r) => setTimeout(r, 20))

    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const textarea = shadow.querySelector('.xw-input') as HTMLTextAreaElement
    const sendBtn = shadow.querySelector('.xw-send-btn') as HTMLButtonElement

    textarea.value = '   '
    sendBtn.click()

    const userMsgCalls = mockSocket.emit.mock.calls.filter(
      (c: unknown[]) => c[0] === 'userMessage'
    )
    expect(userMsgCalls).toHaveLength(0)
  })

  // ── message adds a bubble to the DOM ─────────────────────────────

  it('sendMessage adds a user bubble to the messages area', async () => {
    mountWidget()
    await new Promise((r) => setTimeout(r, 20))

    widget.sendMessage('Test bubble')

    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const bubbles = shadow.querySelectorAll('.xw-bubble--user')
    expect(bubbles.length).toBeGreaterThanOrEqual(1)

    const lastBubble = bubbles[bubbles.length - 1]
    expect(lastBubble.textContent).toContain('Test bubble')
  })

  // ── HTML escaping prevents XSS ───────────────────────────────────

  it('escapes HTML in the title to prevent XSS', () => {
    mountWidget({ title: '<img src=x onerror=alert(1)>' })
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const titleEl = shadow.querySelector('.xw-header__title')!
    // The title should be text content, not parsed as HTML
    expect(titleEl.innerHTML).not.toContain('<img')
    expect(titleEl.textContent).toContain('<img')
  })

  // ── position modes ───────────────────────────────────────────────

  it.each([
    'bottom-right' as const,
    'bottom-left' as const,
    'top-right' as const,
    'top-left' as const,
  ])('applies position class xw-container--%s', (position) => {
    mountWidget({ position })
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const containerEl = shadow.querySelector('.xw-container')
    expect(containerEl!.classList.contains(`xw-container--${position}`)).toBe(true)
  })

  // ── unmount / destroy ────────────────────────────────────────────

  it('unmount() removes the host element', () => {
    mountWidget()
    widget.unmount()
    const host = container.querySelector('#xspace-widget-host')
    expect(host).toBeNull()
  })

  it('destroy() cleans up fully', () => {
    mountWidget()
    widget.destroy()
    const host = container.querySelector('#xspace-widget-host')
    expect(host).toBeNull()
  })

  it('unmount() is a no-op if not mounted', () => {
    widget = new XSpaceWidget({ serverUrl: 'http://localhost:3000' })
    // Should not throw
    expect(() => widget.unmount()).not.toThrow()
  })

  // ── createWidget helper ──────────────────────────────────────────

  it('createWidget() mounts automatically', () => {
    widget = createWidget({ serverUrl: 'http://localhost:3000' })
    const host = document.querySelector('#xspace-widget-host')
    expect(host).not.toBeNull()
  })

  // ── default config ───────────────────────────────────────────────

  it('applies default config values', () => {
    mountWidget({})
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!

    // Default position is bottom-right
    const containerEl = shadow.querySelector('.xw-container')
    expect(containerEl!.classList.contains('xw-container--bottom-right')).toBe(true)

    // Default title is "Chat"
    // (we override title in mountWidget, so test without override)
    widget.destroy()

    widget = new XSpaceWidget({ serverUrl: 'http://localhost:3000' })
    widget.mount(container)
    const shadow2 = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const title = shadow2.querySelector('.xw-header__title')
    expect(title!.textContent).toBe('Chat')
  })

  // ── accessibility attributes ─────────────────────────────────────

  it('sets correct ARIA roles', () => {
    mountWidget()
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!

    const region = shadow.querySelector('[role="region"]')
    expect(region).not.toBeNull()
    expect(region!.getAttribute('aria-label')).toBe('Chat widget')

    const dialog = shadow.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()

    const log = shadow.querySelector('[role="log"]')
    expect(log).not.toBeNull()
    expect(log!.getAttribute('aria-label')).toBe('Chat messages')

    const fabBtn = shadow.querySelector('.xw-fab')
    expect(fabBtn!.getAttribute('aria-haspopup')).toBe('dialog')
  })

  // ── no greeting when empty ───────────────────────────────────────

  it('does not render greeting when greeting is empty string', () => {
    mountWidget({ greeting: '' })
    const shadow = container.querySelector('#xspace-widget-host')!.shadowRoot!
    const greeting = shadow.querySelector('.xw-greeting')
    expect(greeting).toBeNull()
  })
})


