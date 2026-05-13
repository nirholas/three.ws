// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§86]

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPage = {
  goto: vi.fn().mockResolvedValue(undefined),
  url: vi.fn().mockReturnValue('https://x.com/home'),
  $: vi.fn().mockResolvedValue(null),
  setCookie: vi.fn().mockResolvedValue(undefined),
  cookies: vi.fn().mockResolvedValue([{ name: 'auth_token', value: 'x' }]),
  setUserAgent: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn().mockResolvedValue(true),
}

const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  pages: vi.fn().mockResolvedValue([mockPage]),
}

// Track the args that puppeteer.launch was called with
let capturedLaunchArgs: any = null

vi.mock('puppeteer-extra', () => {
  const mod = {
    use: vi.fn(),
    launch: vi.fn().mockImplementation((opts: any) => {
      capturedLaunchArgs = opts
      return Promise.resolve(mockBrowser)
    }),
    connect: vi.fn().mockImplementation(() => Promise.resolve(mockBrowser)),
  }
  return { default: mod }
})

vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: vi.fn().mockReturnValue({}),
}))

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(false),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn().mockReturnValue('[]'),
      unlinkSync: vi.fn(),
    },
    existsSync: vi.fn().mockReturnValue(false),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue('[]'),
    unlinkSync: vi.fn(),
  }
})

// Mock logger
vi.mock('../../../src/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock secure-cookie-store
vi.mock('../../../src/browser/secure-cookie-store', () => ({
  SecureCookieStore: vi.fn().mockImplementation(() => ({
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue([]),
  })),
}))

import { BrowserManager } from '../../../src/browser/launcher'

describe('BrowserManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedLaunchArgs = null
  })

  // ── Constructor & defaults ─────────────────────────────────

  describe('constructor', () => {
    it('should default to managed mode', () => {
      const manager = new BrowserManager()
      expect(manager.isConnectMode).toBe(false)
    })

    it('should detect connect mode from config', () => {
      const manager = new BrowserManager({ mode: 'connect' })
      expect(manager.isConnectMode).toBe(true)
    })
  })

  // ── Managed mode launch ────────────────────────────────────

  describe('launch() in managed mode', () => {
    it('should return browser and page', async () => {
      const manager = new BrowserManager({ headless: true })
      const result = await manager.launch()

      expect(result.browser).toBe(mockBrowser)
      expect(result.page).toBe(mockPage)
    })

    it('should set a user agent on the page', async () => {
      const manager = new BrowserManager()
      await manager.launch()

      expect(mockPage.setUserAgent).toHaveBeenCalledWith(
        expect.stringContaining('Mozilla'),
      )
    })

    it('should throw if launch is called twice without close', async () => {
      const manager = new BrowserManager()
      await manager.launch()

      await expect(manager.launch()).rejects.toThrow(
        /Browser already launched/,
      )
    })

    it('should include required Chrome flags', async () => {
      const manager = new BrowserManager({ headless: true })
      await manager.launch()

      expect(capturedLaunchArgs).toBeDefined()
      const args: string[] = capturedLaunchArgs.args

      expect(args).toContain('--no-sandbox')
      expect(args).toContain('--disable-setuid-sandbox')
      expect(args).toContain('--use-fake-ui-for-media-stream')
      expect(args).toContain('--use-fake-device-for-media-stream')
      expect(args).toContain('--autoplay-policy=no-user-gesture-required')
    })

    it('should pass headless: "new" when headless is true', async () => {
      const manager = new BrowserManager({ headless: true })
      await manager.launch()

      expect(capturedLaunchArgs.headless).toBe('new')
    })

    it('should pass headless: false when headless is false', async () => {
      const manager = new BrowserManager({ headless: false })
      await manager.launch()

      expect(capturedLaunchArgs.headless).toBe(false)
    })

    it('should append extra args from config', async () => {
      const manager = new BrowserManager({
        args: ['--custom-flag', '--another-flag'],
      })
      await manager.launch()

      const args: string[] = capturedLaunchArgs.args
      expect(args).toContain('--custom-flag')
      expect(args).toContain('--another-flag')
    })

    it('should add proxy flag when proxy is configured', async () => {
      const manager = new BrowserManager({ proxy: 'http://proxy.example.com:8080' })
      await manager.launch()

      const args: string[] = capturedLaunchArgs.args
      expect(args).toContain('--proxy-server=http://proxy.example.com:8080')
    })

    it('should use executablePath from config', async () => {
      const manager = new BrowserManager({
        executablePath: '/usr/bin/google-chrome',
      })
      await manager.launch()

      expect(capturedLaunchArgs.executablePath).toBe('/usr/bin/google-chrome')
    })

    it('should use userDataDir from config', async () => {
      const manager = new BrowserManager({
        userDataDir: '/tmp/browser-profile',
      })
      await manager.launch()

      expect(capturedLaunchArgs.userDataDir).toBe('/tmp/browser-profile')
    })

    it('should set default viewport to 1280x720', async () => {
      const manager = new BrowserManager()
      await manager.launch()

      expect(capturedLaunchArgs.defaultViewport).toEqual({
        width: 1280,
        height: 720,
      })
    })
  })

  // ── Connect mode ───────────────────────────────────────────

  describe('launch() in connect mode', () => {
    it('should use provided cdpEndpoint', async () => {
      const manager = new BrowserManager({
        mode: 'connect',
        cdpEndpoint: 'ws://localhost:9222/devtools/browser/abc',
      })
      const result = await manager.launch()

      expect(result.browser).toBe(mockBrowser)
      // In connect mode, the page should be picked from existing pages
      expect(mockBrowser.pages).toHaveBeenCalled()
    })

    it('should verify authentication in connect mode', async () => {
      const manager = new BrowserManager({
        mode: 'connect',
        cdpEndpoint: 'ws://localhost:9222/devtools/browser/abc',
      })

      await manager.launch()

      // verifyAuthenticated evaluates on the page
      expect(mockPage.evaluate).toHaveBeenCalled()
    })
  })

  // ── Close ──────────────────────────────────────────────────

  describe('close()', () => {
    it('should close the browser in managed mode', async () => {
      const manager = new BrowserManager()
      await manager.launch()
      await manager.close()

      expect(mockBrowser.close).toHaveBeenCalled()
    })

    it('should disconnect (not close) in connect mode', async () => {
      const manager = new BrowserManager({
        mode: 'connect',
        cdpEndpoint: 'ws://localhost:9222/devtools/browser/abc',
      })
      await manager.launch()
      await manager.close()

      expect(mockBrowser.disconnect).toHaveBeenCalled()
      expect(mockBrowser.close).not.toHaveBeenCalled()
    })

    it('should null out browser and page references', async () => {
      const manager = new BrowserManager()
      await manager.launch()

      expect(manager.browser).not.toBeNull()
      expect(manager.page).not.toBeNull()

      await manager.close()

      expect(manager.browser).toBeNull()
      expect(manager.page).toBeNull()
    })
  })

  // ── Health check ───────────────────────────────────────────

  describe('healthCheck()', () => {
    it('should report connected: true when browser is running', async () => {
      const manager = new BrowserManager()
      await manager.launch()

      const health = await manager.healthCheck()

      expect(health.connected).toBe(true)
      expect(health.mode).toBe('managed')
      expect(health.pageUrl).toBe('https://x.com/home')
    })

    it('should report connected: false when page url throws', async () => {
      mockPage.url.mockImplementationOnce(() => {
        throw new Error('Target closed')
      })

      const manager = new BrowserManager()
      await manager.launch()
      const health = await manager.healthCheck()

      expect(health.connected).toBe(false)
      expect(health.pageUrl).toBe('disconnected')
    })

    it('should report the correct mode in health check', async () => {
      const manager = new BrowserManager({
        mode: 'connect',
        cdpEndpoint: 'ws://localhost:9222/devtools/browser/abc',
      })
      await manager.launch()

      const health = await manager.healthCheck()
      expect(health.mode).toBe('connect')
    })
  })

  // ── Accessors ──────────────────────────────────────────────

  describe('accessors', () => {
    it('should expose browser via getter', async () => {
      const manager = new BrowserManager()
      expect(manager.browser).toBeNull()

      await manager.launch()
      expect(manager.browser).toBe(mockBrowser)
    })

    it('should expose page via getter', async () => {
      const manager = new BrowserManager()
      expect(manager.page).toBeNull()

      await manager.launch()
      expect(manager.page).toBe(mockPage)
    })
  })
})


