// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module under test is imported
// ---------------------------------------------------------------------------

const mockPage = {
  goto: vi.fn().mockResolvedValue(undefined),
  url: vi.fn().mockReturnValue('https://x.com/home'),
  $: vi.fn().mockResolvedValue(null),
  setCookie: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn().mockResolvedValue([]),
  frames: vi.fn().mockReturnValue([]),
  screenshot: vi.fn().mockResolvedValue(undefined),
  waitForSelector: vi.fn().mockResolvedValue(null),
  createCDPSession: vi.fn().mockResolvedValue({
    send: vi.fn().mockResolvedValue({}),
    detach: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  }),
  on: vi.fn(),
  off: vi.fn(),
}

const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  pages: vi.fn().mockResolvedValue([mockPage]),
}

// Mock BrowserManager — must be a real class so `new BrowserManager(...)` works
vi.mock('../../../src/browser/launcher', () => {
  class MockBrowserManager {
    launch = vi.fn().mockResolvedValue({ browser: mockBrowser, page: mockPage })
    close = vi.fn().mockResolvedValue(undefined)
    isConnectMode: boolean
    constructor(config?: any) {
      this.isConnectMode = config?.mode === 'connect'
    }
  }
  return {
    BrowserManager: MockBrowserManager,
    saveCookies: vi.fn().mockResolvedValue(undefined),
  }
})

// Mock auth
vi.mock('../../../src/browser/auth', () => ({
  login: vi.fn().mockResolvedValue(true),
  isLoggedIn: vi.fn().mockResolvedValue(true),
}))

// Mock space-ui
vi.mock('../../../src/browser/space-ui', () => ({
  joinSpace: vi.fn().mockResolvedValue(undefined),
  requestSpeaker: vi.fn().mockResolvedValue('granted'),
  waitForSpeakerAccess: vi.fn().mockResolvedValue(undefined),
  unmute: vi.fn().mockResolvedValue(undefined),
  aggressiveUnmute: vi.fn().mockResolvedValue(true),
  ensureUnmuted: vi.fn().mockResolvedValue(true),
  isMicUnmuted: vi.fn().mockResolvedValue(true),
  leaveSpace: vi.fn().mockResolvedValue(undefined),
}))

// Mock audio bridge
vi.mock('../../../src/audio/bridge', () => ({
  injectAudioHooks: vi.fn().mockResolvedValue(undefined),
}))

// Mock observer — must be a real class so `new DOMObserver(...)` works
vi.mock('../../../src/browser/observer', () => {
  class MockDOMObserver {
    start = vi.fn().mockResolvedValue(undefined)
    stop = vi.fn().mockResolvedValue(undefined)
    constructor(_page?: any, _engine?: any) { /* noop */ }
  }
  return { DOMObserver: MockDOMObserver }
})

// Mock selector-engine — must be a real class so `new SelectorEngine(...)` works
vi.mock('../../../src/browser/selector-engine', () => {
  class MockSelectorEngine {
    get = vi.fn().mockReturnValue('input[name="test"]')
    find = vi.fn().mockResolvedValue(null)
    getDefinitionNames = vi.fn().mockReturnValue([])
    getDefinition = vi.fn()
    getSuccessCache = vi.fn().mockReturnValue(new Map())
    override = vi.fn()
    constructor(_defs?: any) { /* noop */ }
  }
  return { SelectorEngine: MockSelectorEngine }
})

// Mock selectors
vi.mock('../../../src/browser/selectors', () => ({
  SELECTOR_DEFINITIONS: [],
  SELECTORS: {},
}))

// Mock errors
vi.mock('../../../src/errors', () => ({
  BrowserConnectionError: class BrowserConnectionError extends Error {
    code: string
    hint: string
    constructor(mode: string, detail: string) {
      super(`Browser connection failed (mode: ${mode}): ${detail}`)
      this.name = 'BrowserConnectionError'
      this.code = 'BROWSER_CONNECTION'
      this.hint = ''
    }
  },
}))

import { BrowserLifecycle } from '../../../src/browser/lifecycle'
import { BrowserManager } from '../../../src/browser/launcher'
import { login } from '../../../src/browser/auth'
import * as spaceUI from '../../../src/browser/space-ui'
import { injectAudioHooks } from '../../../src/audio/bridge'
import type { AuthConfig, BrowserConfig } from '../../../src/types'

describe('BrowserLifecycle', () => {
  let lifecycle: BrowserLifecycle
  const authConfig: AuthConfig = { token: 'test-token' }
  const browserConfig: BrowserConfig = { headless: true }
  const onAudioData = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    lifecycle = new BrowserLifecycle(browserConfig, authConfig)
  })

  // ── Launch ──────────────────────────────────────────────────

  describe('launch()', () => {
    it('should launch the browser and return a Page', async () => {
      const page = await lifecycle.launch(onAudioData)

      expect(page).toBe(mockPage)
    })

    it('should inject audio hooks after launching', async () => {
      await lifecycle.launch(onAudioData)

      expect(injectAudioHooks).toHaveBeenCalledWith(
        mockPage,
        onAudioData,
        browserConfig.mode,
      )
    })

    it('should throw BrowserConnectionError if already launched', async () => {
      await lifecycle.launch(onAudioData)

      await expect(lifecycle.launch(onAudioData)).rejects.toThrow(
        /Browser already launched/,
      )
    })

    it('should store the page for later retrieval', async () => {
      expect(lifecycle.getPage()).toBeNull()

      await lifecycle.launch(onAudioData)

      expect(lifecycle.getPage()).toBe(mockPage)
    })

    it('should initialize the DOMObserver', async () => {
      await lifecycle.launch(onAudioData)

      const observer = lifecycle.getObserver()
      expect(observer).not.toBeNull()
    })
  })

  // ── Authenticate ───────────────────────────────────────────

  describe('authenticate()', () => {
    it('should throw if browser is not launched', async () => {
      await expect(lifecycle.authenticate()).rejects.toThrow(
        'Browser not launched',
      )
    })

    it('should call login with page and auth config', async () => {
      await lifecycle.launch(onAudioData)
      await lifecycle.authenticate()

      expect(login).toHaveBeenCalledWith(
        mockPage,
        authConfig,
        expect.any(EventEmitter),
        expect.objectContaining({ selectorEngine: expect.anything() }),
      )
    })

    it('should skip authentication in connect mode', async () => {
      const connectLifecycle = new BrowserLifecycle(
        { mode: 'connect' },
        authConfig,
      )
      await connectLifecycle.launch(onAudioData)
      await connectLifecycle.authenticate()

      expect(login).not.toHaveBeenCalled()
    })

    it('should forward status events from the internal emitter', async () => {
      const statusSpy = vi.fn()
      lifecycle.on('status', statusSpy)

      // Make login emit a status on the internal emitter it receives
      vi.mocked(login).mockImplementationOnce(
        async (_page, _auth, emitter) => {
          emitter.emit('status', 'logging-in')
          return true
        },
      )

      await lifecycle.launch(onAudioData)
      await lifecycle.authenticate()

      expect(statusSpy).toHaveBeenCalledWith('logging-in')
    })

    it('should emit an error event when 2FA is required', async () => {
      const errorSpy = vi.fn()
      lifecycle.on('error', errorSpy)

      vi.mocked(login).mockImplementationOnce(
        async (_page, _auth, emitter) => {
          emitter.emit('2fa-required')
          return true
        },
      )

      await lifecycle.launch(onAudioData)
      await lifecycle.authenticate()

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('2FA') }),
      )
    })
  })

  // ── Join Space ─────────────────────────────────────────────

  describe('joinSpace()', () => {
    const spaceUrl = 'https://x.com/i/spaces/test123'

    it('should throw if browser is not launched', async () => {
      await expect(lifecycle.joinSpace(spaceUrl)).rejects.toThrow(
        'Browser not launched',
      )
    })

    it('should call joinSpace, requestSpeaker, and unmute', async () => {
      await lifecycle.launch(onAudioData)
      await lifecycle.joinSpace(spaceUrl)

      expect(spaceUI.joinSpace).toHaveBeenCalledWith(
        mockPage,
        spaceUrl,
        expect.any(EventEmitter),
        expect.any(Object),
      )
      expect(spaceUI.requestSpeaker).toHaveBeenCalled()
      expect(spaceUI.aggressiveUnmute).toHaveBeenCalled()
    })

    it('should wait for speaker access when request is pending', async () => {
      vi.mocked(spaceUI.requestSpeaker).mockResolvedValueOnce('requested' as any)

      await lifecycle.launch(onAudioData)
      await lifecycle.joinSpace(spaceUrl)

      expect(spaceUI.waitForSpeakerAccess).toHaveBeenCalledWith(
        mockPage,
        expect.any(EventEmitter),
        300000,
        expect.any(Object),
      )
    })
  })

  // ── Leave Space ────────────────────────────────────────────

  describe('leaveSpace()', () => {
    it('should do nothing if page is null', async () => {
      await lifecycle.leaveSpace()

      expect(spaceUI.leaveSpace).not.toHaveBeenCalled()
    })

    it('should call spaceUI.leaveSpace when page is available', async () => {
      await lifecycle.launch(onAudioData)
      await lifecycle.leaveSpace()

      expect(spaceUI.leaveSpace).toHaveBeenCalledWith(
        mockPage,
        expect.any(EventEmitter),
        expect.any(Object),
      )
    })
  })

  // ── Cleanup ────────────────────────────────────────────────

  describe('cleanup()', () => {
    it('should stop observer and close browser manager', async () => {
      await lifecycle.launch(onAudioData)

      const observer = lifecycle.getObserver()
      await lifecycle.cleanup()

      expect(observer!.stop).toHaveBeenCalled()
      expect(lifecycle.getPage()).toBeNull()
      expect(lifecycle.getObserver()).toBeNull()
    })

    it('should be safe to call cleanup when not launched', async () => {
      await expect(lifecycle.cleanup()).resolves.not.toThrow()
    })

    it('should allow re-launching after cleanup', async () => {
      await lifecycle.launch(onAudioData)
      await lifecycle.cleanup()

      // After cleanup, internal state is reset — launch should work again
      const page = await lifecycle.launch(onAudioData)
      expect(page).toBe(mockPage)
    })
  })

  // ── Accessors ──────────────────────────────────────────────

  describe('accessors', () => {
    it('getSelectorEngine() should return a SelectorEngine instance', () => {
      const engine = lifecycle.getSelectorEngine()
      expect(engine).toBeDefined()
    })

    it('getSpaceUIOptions() should contain selectorEngine', () => {
      const opts = lifecycle.getSpaceUIOptions()
      expect(opts.selectorEngine).toBeDefined()
    })

    it('getSpaceUIOptions() should include observer after launch', async () => {
      await lifecycle.launch(onAudioData)

      const opts = lifecycle.getSpaceUIOptions()
      expect(opts.observer).toBeDefined()
    })

    it('isConnectMode should return false by default', () => {
      expect(lifecycle.isConnectMode).toBe(false)
    })
  })

  // ── Events ─────────────────────────────────────────────────

  describe('event emitter', () => {
    it('should support on() for status events', () => {
      const handler = vi.fn()
      lifecycle.on('status', handler)
      // Not crashing = success; the handler is registered
      expect(handler).not.toHaveBeenCalled()
    })

    it('should support on() for error events', () => {
      const handler = vi.fn()
      lifecycle.on('error', handler)
      expect(handler).not.toHaveBeenCalled()
    })
  })
})


