// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockPromptInit = vi.hoisted(() => vi.fn())
const mockWriteConfigFile = vi.hoisted(() => vi.fn())
const mockGetDefaults = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    ai: { provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'You are a helpful AI agent participating in an X Space.' },
    voice: { provider: 'openai' },
    auth: { cookiePath: './.cookies.json' },
    behavior: { autoRespond: true, silenceThreshold: 1.5 },
  })
)
const mockProcessExit = vi.hoisted(() => vi.fn())

vi.mock('../../src/prompts', () => ({
  promptInit: mockPromptInit,
}))

vi.mock('../../src/config', () => ({
  writeConfigFile: mockWriteConfigFile,
  getDefaults: mockGetDefaults,
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

// Mock ora to return a chainable object
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}))

// Mock chalk to pass through strings
vi.mock('chalk', () => {
  const identity = (s: string) => s
  const handler: ProxyHandler<any> = {
    get: () => new Proxy(identity, handler),
    apply: (_target, _this, args) => args[0],
  }
  return { default: new Proxy(identity, handler) }
})

import { initCommand } from '../../src/commands/init'
import { error as logError } from '../../src/logger'

// ── Tests ───────────────────────────────────────────────────────────────────

describe('initCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Replace process.exit with a mock that throws to stop execution
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as any)
  })

  it('collects answers from promptInit and writes config', async () => {
    mockPromptInit.mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-test-key',
      systemPrompt: 'You are a helpful assistant.',
      ttsProvider: 'openai',
    })

    await initCommand({ config: 'xspace.config.json' })

    expect(mockPromptInit).toHaveBeenCalledOnce()
    expect(mockWriteConfigFile).toHaveBeenCalledOnce()

    const [filePath, config] = mockWriteConfigFile.mock.calls[0]
    expect(filePath).toBe('xspace.config.json')
    expect(config.ai.provider).toBe('openai')
    expect(config.ai.apiKey).toBe('sk-test-key')
    expect(config.ai.systemPrompt).toBe('You are a helpful assistant.')
    expect(config.voice.provider).toBe('openai')
  })

  it('includes ttsApiKey in voice config when using elevenlabs', async () => {
    mockPromptInit.mockResolvedValue({
      provider: 'claude',
      apiKey: 'ant-key',
      systemPrompt: 'Be concise.',
      ttsProvider: 'elevenlabs',
      ttsApiKey: 'el-secret',
    })

    await initCommand({ config: 'my-config.json' })

    const [, config] = mockWriteConfigFile.mock.calls[0]
    expect(config.voice.provider).toBe('elevenlabs')
    expect(config.voice.apiKey).toBe('el-secret')
  })

  it('uses custom config path when provided', async () => {
    mockPromptInit.mockResolvedValue({
      provider: 'groq',
      apiKey: 'gsk-key',
      systemPrompt: 'default',
      ttsProvider: 'openai',
    })

    await initCommand({ config: 'custom/path/config.json' })

    const [filePath] = mockWriteConfigFile.mock.calls[0]
    expect(filePath).toBe('custom/path/config.json')
  })

  it('falls back to default config path when options.config is empty', async () => {
    mockPromptInit.mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-key',
      systemPrompt: 'default',
      ttsProvider: 'openai',
    })

    await initCommand({ config: '' })

    const [filePath] = mockWriteConfigFile.mock.calls[0]
    expect(filePath).toBe('xspace.config.json')
  })

  it('preserves defaults for auth and behavior sections', async () => {
    mockPromptInit.mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-key',
      systemPrompt: 'default',
      ttsProvider: 'openai',
    })

    await initCommand({ config: 'xspace.config.json' })

    const [, config] = mockWriteConfigFile.mock.calls[0]
    expect(config.auth).toEqual({ cookiePath: './.cookies.json' })
    expect(config.behavior).toEqual({ autoRespond: true, silenceThreshold: 1.5 })
  })

  it('calls process.exit(1) and logs error on failure', async () => {
    mockPromptInit.mockRejectedValue(new Error('User cancelled'))

    await expect(initCommand({ config: 'xspace.config.json' })).rejects.toThrow('process.exit(1)')

    expect(logError).toHaveBeenCalledWith('Setup failed:', 'User cancelled')
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it('handles non-Error rejection with string conversion', async () => {
    mockPromptInit.mockRejectedValue('something unexpected')

    await expect(initCommand({ config: 'xspace.config.json' })).rejects.toThrow('process.exit(1)')

    expect(logError).toHaveBeenCalledWith('Setup failed:', 'something unexpected')
  })
})


