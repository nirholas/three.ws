// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(),
}))

vi.mock('fs', () => ({
  ...mockFs,
  default: mockFs,
}))

// Silence logger output during tests
vi.mock('../src/logger', () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  banner: vi.fn(),
  spacer: vi.fn(),
  label: vi.fn(),
}))

import * as loggerModule from '../src/logger'
import {
  getDefaults,
  loadConfigFile,
  loadEnvConfig,
  deepMerge,
  resolveConfig,
  writeConfigFile,
  configToEnv,
} from '../src/config'
import type { AgentConfig } from '../src/config'

// ── Tests ───────────────────────────────────────────────────────────────────

describe('config', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset env vars that loadEnvConfig reads
    delete process.env.AI_PROVIDER
    delete process.env.AI_MODEL
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GROQ_API_KEY
    delete process.env.SYSTEM_PROMPT
    delete process.env.TTS_PROVIDER
    delete process.env.X_AUTH_TOKEN
  })

  afterEach(() => {
    process.env = { ...savedEnv }
  })

  // ── getDefaults ─────────────────────────────────────────────────────────

  describe('getDefaults', () => {
    it('returns default config object', () => {
      const defaults = getDefaults()
      expect(defaults.ai.provider).toBe('openai')
      expect(defaults.ai.model).toBe('gpt-4o-mini')
      expect(defaults.voice.provider).toBe('openai')
      expect(defaults.behavior.autoRespond).toBe(true)
      expect(defaults.behavior.silenceThreshold).toBe(1.5)
      expect(defaults.auth.cookiePath).toBe('./.cookies.json')
    })

    it('returns a deep copy (mutation-safe)', () => {
      const a = getDefaults()
      const b = getDefaults()
      a.ai.provider = 'changed'
      expect(b.ai.provider).toBe('openai')
    })
  })

  // ── loadConfigFile ──────────────────────────────────────────────────────

  describe('loadConfigFile', () => {
    it('returns null when file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false)
      const result = loadConfigFile('missing.json')
      expect(result).toBeNull()
    })

    it('reads and parses a valid JSON config file', () => {
      const configObj = { ai: { provider: 'groq' } }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.statSync.mockReturnValue({ mode: 0o100600 })
      mockFs.readFileSync.mockReturnValue(JSON.stringify(configObj))

      const result = loadConfigFile('xspace.config.json')
      expect(result).toEqual(configObj)
    })

    it('returns null on invalid JSON', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.statSync.mockReturnValue({ mode: 0o100600 })
      mockFs.readFileSync.mockReturnValue('not json {{{')

      const result = loadConfigFile('bad.json')
      expect(result).toBeNull()
    })

    it('warns if config file is world-readable (group/other bits set)', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.statSync.mockReturnValue({ mode: 0o100644 }) // readable by group+others
      mockFs.readFileSync.mockReturnValue('{}')

      loadConfigFile('open-perms.json')
      expect(loggerModule.warn).toHaveBeenCalled()
      expect((loggerModule.warn as any).mock.calls[0][0]).toContain('readable by group/others')
    })

    it('does not warn when file permissions are owner-only', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.statSync.mockReturnValue({ mode: 0o100600 })
      mockFs.readFileSync.mockReturnValue('{}')

      loadConfigFile('secure.json')
      expect(loggerModule.warn).not.toHaveBeenCalled()
    })
  })

  // ── loadEnvConfig ───────────────────────────────────────────────────────

  describe('loadEnvConfig', () => {
    it('returns empty object when no env vars are set', () => {
      const result = loadEnvConfig()
      expect(result).toEqual({})
    })

    it('reads AI_PROVIDER from env', () => {
      process.env.AI_PROVIDER = 'claude'
      const result = loadEnvConfig()
      expect(result.ai?.provider).toBe('claude')
    })

    it('reads AI_MODEL from env', () => {
      process.env.AI_MODEL = 'gpt-4'
      const result = loadEnvConfig()
      expect(result.ai?.model).toBe('gpt-4')
      // When provider is not set but other ai fields are, it defaults to 'openai'
      expect(result.ai?.provider).toBe('openai')
    })

    it('reads OPENAI_API_KEY from env', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key'
      const result = loadEnvConfig()
      expect(result.ai?.apiKey).toBe('sk-test-key')
    })

    it('reads ANTHROPIC_API_KEY when OPENAI_API_KEY is not set', () => {
      process.env.ANTHROPIC_API_KEY = 'ant-key'
      const result = loadEnvConfig()
      expect(result.ai?.apiKey).toBe('ant-key')
    })

    it('reads GROQ_API_KEY as fallback', () => {
      process.env.GROQ_API_KEY = 'gsk-key'
      const result = loadEnvConfig()
      expect(result.ai?.apiKey).toBe('gsk-key')
    })

    it('reads TTS_PROVIDER from env', () => {
      process.env.TTS_PROVIDER = 'elevenlabs'
      const result = loadEnvConfig()
      expect(result.voice?.provider).toBe('elevenlabs')
    })

    it('reads X_AUTH_TOKEN from env', () => {
      process.env.X_AUTH_TOKEN = 'auth-token-123'
      const result = loadEnvConfig()
      expect(result.auth?.authToken).toBe('auth-token-123')
    })

    it('reads SYSTEM_PROMPT from env', () => {
      process.env.SYSTEM_PROMPT = 'You are a pirate.'
      const result = loadEnvConfig()
      expect(result.ai?.systemPrompt).toBe('You are a pirate.')
    })
  })

  // ── deepMerge ───────────────────────────────────────────────────────────

  describe('deepMerge', () => {
    it('merges flat objects', () => {
      const result = deepMerge({ a: 1 }, { b: 2 })
      expect(result).toEqual({ a: 1, b: 2 })
    })

    it('later sources override earlier ones', () => {
      const result = deepMerge({ a: 1 }, { a: 2 })
      expect(result).toEqual({ a: 2 })
    })

    it('deep merges nested objects', () => {
      const result = deepMerge(
        { ai: { provider: 'openai', model: 'gpt-4o-mini' } },
        { ai: { provider: 'claude' } }
      )
      expect(result).toEqual({ ai: { provider: 'claude', model: 'gpt-4o-mini' } })
    })

    it('skips null and undefined sources', () => {
      const result = deepMerge({ a: 1 }, null, undefined, { b: 2 })
      expect(result).toEqual({ a: 1, b: 2 })
    })

    it('does not merge arrays (replaces them)', () => {
      const result = deepMerge({ items: [1, 2] }, { items: [3] })
      expect(result).toEqual({ items: [3] })
    })

    it('ignores undefined values in sources', () => {
      const result = deepMerge({ a: 1 }, { a: undefined })
      expect(result).toEqual({ a: 1 })
    })
  })

  // ── resolveConfig ──────────────────────────────────────────────────────

  describe('resolveConfig', () => {
    it('falls back to defaults when no file or env is set', () => {
      mockFs.existsSync.mockReturnValue(false)

      const config = resolveConfig('xspace.config.json', {})
      expect(config.ai.provider).toBe('openai')
      expect(config.ai.model).toBe('gpt-4o-mini')
      expect(config.behavior.autoRespond).toBe(true)
    })

    it('file config overrides defaults', () => {
      const fileConfig = { ai: { provider: 'groq' } }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.statSync.mockReturnValue({ mode: 0o100600 })
      mockFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig))

      const config = resolveConfig('xspace.config.json', {})
      expect(config.ai.provider).toBe('groq')
      // Other defaults still present
      expect(config.ai.model).toBe('gpt-4o-mini')
    })

    it('env config overrides defaults (but file overrides env)', () => {
      process.env.AI_PROVIDER = 'claude'
      mockFs.existsSync.mockReturnValue(false)

      const config = resolveConfig('xspace.config.json', {})
      expect(config.ai.provider).toBe('claude')
    })

    it('CLI flags have highest priority', () => {
      process.env.AI_PROVIDER = 'groq'
      const fileConfig = { ai: { provider: 'claude' } }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.statSync.mockReturnValue({ mode: 0o100600 })
      mockFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig))

      const config = resolveConfig('xspace.config.json', {
        ai: { provider: 'openai' },
      })
      expect(config.ai.provider).toBe('openai')
    })
  })

  // ── writeConfigFile ────────────────────────────────────────────────────

  describe('writeConfigFile', () => {
    it('writes JSON with $schema field and 0600 permissions', () => {
      mockFs.statSync.mockReturnValue({ mode: 0o100600 })

      const config = getDefaults()
      writeConfigFile('xspace.config.json', config)

      expect(mockFs.writeFileSync).toHaveBeenCalledOnce()
      const [filePath, content, options] = mockFs.writeFileSync.mock.calls[0]
      expect(path.basename(filePath as string)).toBe('xspace.config.json')

      const parsed = JSON.parse(content as string)
      expect(parsed.$schema).toBe('https://unpkg.com/xspace-agent/config-schema.json')
      expect(parsed.ai.provider).toBe('openai')

      expect(options).toEqual(
        expect.objectContaining({ mode: 0o600 })
      )
    })
  })

  // ── configToEnv ────────────────────────────────────────────────────────

  describe('configToEnv', () => {
    it('sets env vars for openai provider', () => {
      const config: AgentConfig = {
        ai: { provider: 'openai', apiKey: 'sk-key', systemPrompt: 'hello' },
        voice: { provider: 'openai' },
        auth: { authToken: 'tok-123', cookiePath: './cookies' },
        behavior: { autoRespond: true, silenceThreshold: 1.5 },
      }

      configToEnv(config)

      expect(process.env.AI_PROVIDER).toBe('openai')
      expect(process.env.OPENAI_API_KEY).toBe('sk-key')
      expect(process.env.SYSTEM_PROMPT).toBe('hello')
      expect(process.env.TTS_PROVIDER).toBe('openai')
      expect(process.env.X_AUTH_TOKEN).toBe('tok-123')
      expect(process.env.COOKIE_PATH).toBe('./cookies')
    })

    it('sets ANTHROPIC_API_KEY for claude provider', () => {
      const config: AgentConfig = {
        ai: { provider: 'claude', apiKey: 'ant-key' },
        voice: { provider: 'openai' },
        auth: {},
        behavior: {},
      }

      configToEnv(config)
      expect(process.env.ANTHROPIC_API_KEY).toBe('ant-key')
    })

    it('sets GROQ_API_KEY for groq provider', () => {
      const config: AgentConfig = {
        ai: { provider: 'groq', apiKey: 'gsk-key' },
        voice: { provider: 'openai' },
        auth: {},
        behavior: {},
      }

      configToEnv(config)
      expect(process.env.GROQ_API_KEY).toBe('gsk-key')
    })

    it('sets ELEVENLABS_API_KEY for voice config', () => {
      const config: AgentConfig = {
        ai: { provider: 'openai' },
        voice: { provider: 'elevenlabs', apiKey: 'el-key' },
        auth: {},
        behavior: {},
      }

      configToEnv(config)
      expect(process.env.ELEVENLABS_API_KEY).toBe('el-key')
    })
  })
})


