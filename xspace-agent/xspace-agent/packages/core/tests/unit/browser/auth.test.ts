// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// ---------------------------------------------------------------------------
// Mock Puppeteer Page
// ---------------------------------------------------------------------------

function createMockPage(overrides: Record<string, any> = {}) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue('https://x.com/home'),
    $: vi.fn().mockResolvedValue(null),
    $$: vi.fn().mockResolvedValue([]),
    setCookie: vi.fn().mockResolvedValue(undefined),
    cookies: vi.fn().mockResolvedValue([]),
    type: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue({
      click: vi.fn(),
      type: vi.fn(),
    }),
    evaluate: vi.fn().mockResolvedValue(''),
    evaluateHandle: vi.fn().mockResolvedValue({
      asElement: vi.fn().mockReturnValue(null),
      dispose: vi.fn(),
    }),
    screenshot: vi.fn().mockResolvedValue(undefined),
    createCDPSession: vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({}),
      detach: vi.fn().mockResolvedValue(undefined),
    }),
    ...overrides,
  } as any
}

// Mock the launcher to avoid importing puppeteer-extra
vi.mock('../../../src/browser/launcher', () => ({
  saveCookies: vi.fn().mockResolvedValue(undefined),
}))

// Mock selectors
vi.mock('../../../src/browser/selectors', () => ({
  SELECTORS: {
    HOME_URL: 'https://x.com/home',
    LOGIN_USERNAME_INPUT: 'input[autocomplete="username"]',
    LOGIN_PASSWORD_INPUT: 'input[name="password"]',
    LOGIN_SUBMIT_BUTTON: '[data-testid="LoginForm_Login_Button"]',
    VERIFY_EMAIL_INPUT: 'input[data-testid="ocfEnterTextTextInput"]',
    VERIFY_NEXT_BUTTON: '[data-testid="ocfEnterTextNextButton"]',
  },
  SELECTOR_DEFINITIONS: [],
}))

// Mock logger
vi.mock('../../../src/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock errors
vi.mock('../../../src/errors', () => ({
  AuthenticationError: class AuthenticationError extends Error {
    code: string
    hint: string
    constructor(message: string, hint?: string) {
      super(message)
      this.name = 'AuthenticationError'
      this.code = 'AUTH_FAILED'
      this.hint = hint ?? ''
    }
  },
}))

import { login, isLoggedIn } from '../../../src/browser/auth'
import { saveCookies } from '../../../src/browser/launcher'

describe('isLoggedIn()', () => {
  it('should return true when URL contains /home and not /login', async () => {
    const page = createMockPage({
      url: vi.fn().mockReturnValue('https://x.com/home'),
    })

    const result = await isLoggedIn(page)
    expect(result).toBe(true)
  })

  it('should return false when URL contains /login', async () => {
    const page = createMockPage({
      url: vi.fn().mockReturnValue('https://x.com/i/flow/login'),
    })

    const result = await isLoggedIn(page)
    expect(result).toBe(false)
  })

  it('should return false when navigation fails', async () => {
    const page = createMockPage({
      goto: vi.fn().mockRejectedValue(new Error('Navigation timeout')),
    })

    const result = await isLoggedIn(page)
    expect(result).toBe(false)
  })

  it('should navigate to the home URL', async () => {
    const page = createMockPage()
    await isLoggedIn(page)

    expect(page.goto).toHaveBeenCalledWith('https://x.com/home', {
      waitUntil: 'networkidle2',
      timeout: 15000,
    })
  })
})

describe('login()', () => {
  let emitter: EventEmitter

  beforeEach(() => {
    vi.clearAllMocks()
    emitter = new EventEmitter()
  })

  // ── Already logged in ────────────────────────────────────

  describe('when already logged in via cookies', () => {
    it('should emit logged-in status and return true', async () => {
      const page = createMockPage({
        url: vi.fn().mockReturnValue('https://x.com/home'),
      })

      const statusSpy = vi.fn()
      emitter.on('status', statusSpy)

      const result = await login(page, { token: 'test' }, emitter)

      expect(result).toBe(true)
      expect(statusSpy).toHaveBeenCalledWith('logged-in')
    })

    it('should not attempt token injection if already logged in', async () => {
      const page = createMockPage({
        url: vi.fn().mockReturnValue('https://x.com/home'),
      })

      await login(page, { token: 'test' }, emitter)

      expect(page.setCookie).not.toHaveBeenCalled()
    })
  })

  // ── Token-based auth ─────────────────────────────────────

  describe('token-based authentication', () => {
    it('should set auth_token cookie', async () => {
      const page = createMockPage({
        // First call: not logged in; second call (after setCookie): logged in
        url: vi
          .fn()
          .mockReturnValueOnce('https://x.com/i/flow/login')
          .mockReturnValueOnce('https://x.com/home'),
      })

      await login(page, { token: 'my-auth-token' }, emitter)

      expect(page.setCookie).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'auth_token',
          value: 'my-auth-token',
          domain: '.x.com',
        }),
      )
    })

    it('should also set ct0 cookie when provided', async () => {
      const page = createMockPage({
        url: vi
          .fn()
          .mockReturnValueOnce('https://x.com/i/flow/login')
          .mockReturnValueOnce('https://x.com/home'),
      })

      await login(
        page,
        { token: 'my-auth-token', ct0: 'my-ct0' },
        emitter,
      )

      expect(page.setCookie).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'auth_token', value: 'my-auth-token' }),
        expect.objectContaining({ name: 'ct0', value: 'my-ct0' }),
      )
    })

    it('should throw AuthenticationError when token is expired/invalid', async () => {
      const page = createMockPage({
        url: vi.fn().mockReturnValue('https://x.com/i/flow/login'),
      })

      await expect(
        login(page, { token: 'expired-token' }, emitter),
      ).rejects.toThrow(/auth_token is invalid or expired/)
    })

    it('should save cookies after successful token login', async () => {
      const page = createMockPage({
        url: vi
          .fn()
          .mockReturnValueOnce('https://x.com/i/flow/login')
          .mockReturnValueOnce('https://x.com/home'),
      })

      await login(
        page,
        { token: 'valid-token', cookiePath: '/tmp/cookies.json' },
        emitter,
      )

      expect(saveCookies).toHaveBeenCalledWith(page, '/tmp/cookies.json')
    })

    it('should emit status events during token login', async () => {
      const page = createMockPage({
        url: vi
          .fn()
          .mockReturnValueOnce('https://x.com/i/flow/login')
          .mockReturnValueOnce('https://x.com/home'),
      })

      const statusSpy = vi.fn()
      emitter.on('status', statusSpy)

      await login(page, { token: 'valid-token' }, emitter)

      expect(statusSpy).toHaveBeenCalledWith('logging-in')
      expect(statusSpy).toHaveBeenCalledWith('logged-in')
    })
  })

  // ── Missing credentials ──────────────────────────────────

  describe('when credentials are missing', () => {
    it('should throw AuthenticationError with no token, username, or password', async () => {
      const page = createMockPage({
        url: vi.fn().mockReturnValue('https://x.com/i/flow/login'),
      })

      await expect(login(page, {}, emitter)).rejects.toThrow(
        /No authentication credentials provided/,
      )
    })

    it('should throw when only username is provided (no password)', async () => {
      const page = createMockPage({
        url: vi.fn().mockReturnValue('https://x.com/i/flow/login'),
      })

      await expect(
        login(page, { username: 'user' }, emitter),
      ).rejects.toThrow(/No authentication credentials provided/)
    })
  })

  // ── Form-based login ─────────────────────────────────────

  describe('form-based login', () => {
    it('should navigate to the login page', async () => {
      const clickableMock = {
        click: vi.fn().mockResolvedValue(undefined),
        type: vi.fn().mockResolvedValue(undefined),
      }

      // url() is called: (1) initial isLoggedIn, (2) final isLoggedIn
      // The 2FA check short-circuits on null twoFaInput, so url() is NOT called there.
      const urlMock = vi.fn().mockReturnValue('https://x.com/home')
      // First call (initial isLoggedIn): not logged in
      urlMock.mockReturnValueOnce('https://x.com/i/flow/login')
      // Subsequent calls fall through to default: 'https://x.com/home'

      const page = createMockPage({
        url: urlMock,
        $: vi.fn().mockResolvedValue(null),
        waitForSelector: vi.fn().mockResolvedValue(clickableMock),
      })

      page.$$.mockResolvedValue([])

      await login(
        page,
        { username: 'testuser', password: 'testpass' },
        emitter,
      )

      expect(page.goto).toHaveBeenCalledWith(
        'https://x.com/i/flow/login',
        expect.objectContaining({ waitUntil: 'networkidle2' }),
      )
    })

    it('should throw AuthenticationError when form login fails', async () => {
      const page = createMockPage({
        url: vi.fn().mockReturnValue('https://x.com/i/flow/login'),
        $: vi.fn().mockResolvedValue(null),
        waitForSelector: vi.fn().mockResolvedValue({
          click: vi.fn(),
          type: vi.fn(),
        }),
      })

      await expect(
        login(
          page,
          { username: 'testuser', password: 'wrongpass' },
          emitter,
        ),
      ).rejects.toThrow(/Login failed/)
    })
  })

  // ── SelectorEngine integration ───────────────────────────

  describe('SelectorEngine option', () => {
    it('should pass selectorEngine in opts when provided', async () => {
      const page = createMockPage({
        url: vi.fn().mockReturnValue('https://x.com/home'),
      })

      const mockEngine = {
        find: vi.fn().mockResolvedValue(null),
        get: vi.fn().mockReturnValue('input[name="test"]'),
      } as any

      const result = await login(page, { token: 'test' }, emitter, {
        selectorEngine: mockEngine,
      })

      // Should succeed (already logged in) — the engine is just passed through
      expect(result).toBe(true)
    })
  })
})


