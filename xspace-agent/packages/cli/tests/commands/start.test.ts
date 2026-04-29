// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§67]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockResolveConfig = vi.hoisted(() => vi.fn())
const mockConfigToEnv = vi.hoisted(() => vi.fn())
const mockServerStart = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockServerStop = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockCreateServer = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    start: mockServerStart,
    stop: mockServerStop,
  }))
)

vi.mock('../../src/config', () => ({
  resolveConfig: mockResolveConfig,
  configToEnv: mockConfigToEnv,
}))

vi.mock('../../src/logger', () => ({
  banner: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  spacer: vi.fn(),
  label: vi.fn(),
}))

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}))

vi.mock('chalk', () => {
  const identity = (s: string) => s
  const handler: ProxyHandler<any> = {
    get: () => new Proxy(identity, handler),
    apply: (_target, _this, args) => args[0],
  }
  return { default: new Proxy(identity, handler) }
})

vi.mock('dotenv', () => ({
  config: vi.fn(),
}))

// Mock @xspace/server — the start command dynamic-imports this
vi.mock('@xspace/server', () => ({
  createServer: mockCreateServer,
}))

import { startCommand } from '../../src/commands/start'
import { error as logError, label } from '../../src/logger'

// ── Tests ───────────────────────────────────────────────────────────────────

describe('startCommand', () => {
  const savedEnv = { ...process.env }

  const defaultConfig = {
    ai: { provider: 'openai', model: 'gpt-4o-mini' },
    voice: { provider: 'openai' },
    auth: {},
    behavior: { autoRespond: true },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveConfig.mockReturnValue(defaultConfig)
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as any)
  })

  afterEach(() => {
    process.env = { ...savedEnv }
  })

  // ── Successful start ──────────────────────────────────────────────────

  describe('successful start', () => {
    it('resolves config and starts server', async () => {
      await startCommand({
        config: 'xspace.config.json',
        port: '3000',
      })

      expect(mockResolveConfig).toHaveBeenCalledWith('xspace.config.json', {})
      expect(mockConfigToEnv).toHaveBeenCalledWith(defaultConfig)
      expect(mockServerStart).toHaveBeenCalledOnce()
    })

    it('starts server on specified port', async () => {
      await startCommand({
        config: 'xspace.config.json',
        port: '4000',
      })

      expect(mockCreateServer).toHaveBeenCalledWith(
        expect.objectContaining({ port: 4000 })
      )
    })

    it('defaults to port 3000 on invalid port value', async () => {
      await startCommand({
        config: 'xspace.config.json',
        port: 'not-a-number',
      })

      expect(mockCreateServer).toHaveBeenCalledWith(
        expect.objectContaining({ port: 3000 })
      )
    })

    it('passes headless and verbose options to server', async () => {
      await startCommand({
        config: 'xspace.config.json',
        port: '3000',
        headless: true,
        verbose: true,
      })

      expect(mockCreateServer).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          verbose: true,
        })
      )
    })

    it('displays admin panel and dashboard URLs', async () => {
      await startCommand({
        config: 'xspace.config.json',
        port: '5000',
      })

      expect(label).toHaveBeenCalledWith('Admin panel', 'http://localhost:5000/admin')
      expect(label).toHaveBeenCalledWith('Dashboard', 'http://localhost:5000')
    })

    it('displays AI provider from config', async () => {
      const groqConfig = { ...defaultConfig, ai: { ...defaultConfig.ai, provider: 'groq' } }
      mockResolveConfig.mockReturnValue(groqConfig)

      await startCommand({
        config: 'xspace.config.json',
        port: '3000',
      })

      expect(label).toHaveBeenCalledWith('AI Provider', 'groq')
    })
  })

  // ── Error handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('exits with error when server fails to start', async () => {
      mockServerStart.mockRejectedValueOnce(new Error('EADDRINUSE: port 3000 already in use'))

      await expect(
        startCommand({
          config: 'xspace.config.json',
          port: '3000',
        })
      ).rejects.toThrow('process.exit(1)')

      expect(logError).toHaveBeenCalledWith('EADDRINUSE: port 3000 already in use')
    })

    it('exits with error when createServer throws', async () => {
      mockCreateServer.mockImplementationOnce(() => {
        throw new Error('Module not found')
      })

      await expect(
        startCommand({
          config: 'xspace.config.json',
          port: '3000',
        })
      ).rejects.toThrow('process.exit(1)')

      expect(logError).toHaveBeenCalledWith('Module not found')
    })

    it('handles non-Error thrown values', async () => {
      mockServerStart.mockRejectedValueOnce('connection refused')

      await expect(
        startCommand({
          config: 'xspace.config.json',
          port: '3000',
        })
      ).rejects.toThrow('process.exit(1)')

      expect(logError).toHaveBeenCalledWith('connection refused')
    })
  })

  // ── Signal handling ───────────────────────────────────────────────────

  describe('signal handling', () => {
    it('registers SIGINT and SIGTERM handlers', async () => {
      const onSpy = vi.spyOn(process, 'on')

      await startCommand({
        config: 'xspace.config.json',
        port: '3000',
      })

      const registeredSignals = onSpy.mock.calls.map((call) => call[0])
      expect(registeredSignals).toContain('SIGINT')
      expect(registeredSignals).toContain('SIGTERM')

      onSpy.mockRestore()
    })
  })
})


