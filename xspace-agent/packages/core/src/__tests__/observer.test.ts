// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§67]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DOMObserver } from '../browser/observer'
import { SelectorEngine } from '../browser/selector-engine'
import type { SelectorDefinition } from '../browser/selector-engine'

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

const TEST_DEFINITIONS: SelectorDefinition[] = [
  {
    name: 'unmute',
    description: 'Unmute button',
    strategies: [
      { name: 'aria', selector: 'button[aria-label="Unmute"]', priority: 1 },
    ],
  },
  {
    name: 'space-ended',
    description: 'Space ended indicator',
    strategies: [
      { name: 'testid', selector: '[data-testid="spaceEnded"]', priority: 1 },
    ],
    textMatch: 'has ended',
  },
]

function createMockCDPSession() {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {}
  return {
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(handler)
    }),
    detach: vi.fn().mockResolvedValue(undefined),
    // Test helper: trigger a CDP event
    _emit(event: string, ...args: any[]) {
      for (const handler of listeners[event] || []) {
        handler(...args)
      }
    },
    _listeners: listeners,
  }
}

function createMockPage(options: { domState?: Record<string, boolean> } = {}) {
  const domState = options.domState ?? {}
  const pageListeners: Record<string, Array<(...args: any[]) => void>> = {}
  const cdp = createMockCDPSession()

  return {
    page: {
      createCDPSession: vi.fn().mockResolvedValue(cdp),
      $: vi.fn().mockImplementation(async (selector: string) => {
        if (domState[selector]) return { dispose: vi.fn() }
        return null
      }),
      evaluateHandle: vi.fn().mockImplementation(async () => ({
        asElement: () => null,
        dispose: vi.fn(),
      })),
      on: vi.fn().mockImplementation((event: string, handler: (...args: any[]) => void) => {
        if (!pageListeners[event]) pageListeners[event] = []
        pageListeners[event].push(handler)
      }),
      mainFrame: vi.fn().mockReturnValue({ id: 'main' }),
      url: vi.fn().mockReturnValue('https://x.com/i/spaces/abc'),
    } as any,
    cdp,
    pageListeners,
    domState,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DOMObserver', () => {
  let engine: SelectorEngine

  beforeEach(() => {
    vi.useFakeTimers()
    engine = new SelectorEngine(TEST_DEFINITIONS)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('start()', () => {
    it('creates a CDP session and enables DOM + Network domains', async () => {
      const { page, cdp } = createMockPage()
      const observer = new DOMObserver(page, engine)
      await observer.start()

      expect(page.createCDPSession).toHaveBeenCalled()
      expect(cdp.send).toHaveBeenCalledWith('DOM.enable')
      expect(cdp.send).toHaveBeenCalledWith('Network.enable')

      await observer.stop()
    })

    it('registers CDP event listeners', async () => {
      const { page, cdp } = createMockPage()
      const observer = new DOMObserver(page, engine)
      await observer.start()

      const registeredEvents = cdp.on.mock.calls.map((c: any) => c[0])
      expect(registeredEvents).toContain('DOM.documentUpdated')
      expect(registeredEvents).toContain('DOM.childNodeInserted')
      expect(registeredEvents).toContain('DOM.childNodeRemoved')
      expect(registeredEvents).toContain('DOM.attributeModified')
      expect(registeredEvents).toContain('Network.webSocketClosed')

      await observer.stop()
    })

    it('is idempotent (calling start twice does not double-register)', async () => {
      const { page } = createMockPage()
      const observer = new DOMObserver(page, engine)
      await observer.start()
      await observer.start()

      expect(page.createCDPSession).toHaveBeenCalledTimes(1)

      await observer.stop()
    })
  })

  describe('watch() / unwatch()', () => {
    it('tracks watched selectors', async () => {
      const { page } = createMockPage()
      const observer = new DOMObserver(page, engine)
      await observer.start()

      observer.watch('unmute')
      expect(observer.isFound('unmute')).toBe(false)

      observer.unwatch('unmute')
      expect(observer.isFound('unmute')).toBe(false)

      await observer.stop()
    })

    it('immediately checks DOM when watch() is called', async () => {
      const { page } = createMockPage({
        domState: { 'button[aria-label="Unmute"]': true },
      })
      const observer = new DOMObserver(page, engine)
      await observer.start()

      const appeared = vi.fn()
      observer.on('element:appeared', appeared)

      observer.watch('unmute')

      // The immediate check is async — flush microtasks
      await vi.advanceTimersByTimeAsync(10)

      expect(appeared).toHaveBeenCalledWith('unmute')
      expect(observer.isFound('unmute')).toBe(true)

      await observer.stop()
    })
  })

  describe('element:appeared / element:disappeared', () => {
    it('emits element:appeared when a watched element is found during recheck', async () => {
      const { page, cdp, domState } = createMockPage()
      const observer = new DOMObserver(page, engine)
      await observer.start()

      const appeared = vi.fn()
      observer.on('element:appeared', appeared)

      observer.watch('unmute')
      await vi.advanceTimersByTimeAsync(10) // initial check — not found

      // Simulate the element appearing in the DOM
      domState['button[aria-label="Unmute"]'] = true
      cdp._emit('DOM.childNodeInserted')

      // Debounce fires after 150ms
      await vi.advanceTimersByTimeAsync(200)

      expect(appeared).toHaveBeenCalledWith('unmute')
    })

    it('emits element:disappeared when a watched element is removed', async () => {
      const { page, cdp, domState } = createMockPage({
        domState: { 'button[aria-label="Unmute"]': true },
      })
      const observer = new DOMObserver(page, engine)
      await observer.start()

      const disappeared = vi.fn()
      observer.on('element:disappeared', disappeared)

      observer.watch('unmute')
      await vi.advanceTimersByTimeAsync(10) // initial check — found
      expect(observer.isFound('unmute')).toBe(true)

      // Remove the element
      domState['button[aria-label="Unmute"]'] = false
      cdp._emit('DOM.childNodeRemoved')

      await vi.advanceTimersByTimeAsync(200)

      expect(disappeared).toHaveBeenCalledWith('unmute')
      expect(observer.isFound('unmute')).toBe(false)
    })

    it('does not emit when state has not changed', async () => {
      const { page, cdp } = createMockPage({
        domState: { 'button[aria-label="Unmute"]': true },
      })
      const observer = new DOMObserver(page, engine)
      await observer.start()

      const appeared = vi.fn()
      observer.on('element:appeared', appeared)

      observer.watch('unmute')
      await vi.advanceTimersByTimeAsync(10) // initial — found

      expect(appeared).toHaveBeenCalledTimes(1)

      // Trigger another recheck with same state
      cdp._emit('DOM.attributeModified', { name: 'class', value: 'foo' })
      await vi.advanceTimersByTimeAsync(200)

      // Should not fire appeared again
      expect(appeared).toHaveBeenCalledTimes(1)
    })
  })

  describe('network:ws-closed', () => {
    it('emits when a WebSocket closes', async () => {
      const { page, cdp } = createMockPage()
      const observer = new DOMObserver(page, engine)
      await observer.start()

      const wsClosed = vi.fn()
      observer.on('network:ws-closed', wsClosed)

      cdp._emit('Network.webSocketClosed')

      expect(wsClosed).toHaveBeenCalled()

      await observer.stop()
    })
  })

  describe('debouncing', () => {
    it('batches rapid DOM mutations into a single recheck', async () => {
      const { page, cdp } = createMockPage()
      const observer = new DOMObserver(page, engine)
      await observer.start()

      observer.watch('unmute')
      await vi.advanceTimersByTimeAsync(10) // initial check

      const findSpy = vi.spyOn(engine, 'find')
      findSpy.mockClear()

      // Fire multiple mutations rapidly
      cdp._emit('DOM.childNodeInserted')
      cdp._emit('DOM.childNodeInserted')
      cdp._emit('DOM.childNodeRemoved')
      cdp._emit('DOM.attributeModified', {})

      // Only one recheck should be scheduled
      await vi.advanceTimersByTimeAsync(200)

      // find was called once per watched selector (1) per recheck (1)
      expect(findSpy).toHaveBeenCalledTimes(1)

      findSpy.mockRestore()
      await observer.stop()
    })
  })

  describe('stop()', () => {
    it('detaches CDP session and clears state', async () => {
      const { page, cdp } = createMockPage()
      const observer = new DOMObserver(page, engine)
      await observer.start()

      observer.watch('unmute')

      await observer.stop()

      expect(cdp.detach).toHaveBeenCalled()
      expect(observer.isFound('unmute')).toBe(false)
    })

    it('is safe to call multiple times', async () => {
      const { page } = createMockPage()
      const observer = new DOMObserver(page, engine)
      await observer.start()
      await observer.stop()
      await observer.stop() // should not throw
    })
  })
})


