// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

import { describe, it, expect } from 'vitest'
import { validateConfig, AgentConfigSchema } from '../../src/config'
import { ConfigValidationError } from '../../src/errors'

describe('validateConfig', () => {
  // ---------------------------------------------------------------------------
  // Valid configurations
  // ---------------------------------------------------------------------------

  const validTokenConfig = {
    auth: { token: 'abc123' },
    ai: { provider: 'openai', systemPrompt: 'You are helpful.', apiKey: 'sk-xxx' },
  }

  const validPasswordConfig = {
    auth: { username: 'user', password: 'pass' },
    ai: { provider: 'claude', systemPrompt: 'Be nice.', apiKey: 'sk-ant-xxx' },
  }

  it('should accept valid token-based auth config', () => {
    const result = validateConfig(validTokenConfig)
    expect(result.auth).toBeDefined()
    expect(result.ai.provider).toBe('openai')
    expect(result.ai.systemPrompt).toBe('You are helpful.')
  })

  it('should accept valid username/password auth config', () => {
    const result = validateConfig(validPasswordConfig)
    expect(result.ai.provider).toBe('claude')
  })

  it('should accept all optional fields', () => {
    const config = {
      auth: { token: 'abc', ct0: 'csrf-token', cookiePath: '/tmp/cookies.json' },
      ai: {
        provider: 'groq' as const,
        systemPrompt: 'Hello',
        model: 'llama3-70b',
        apiKey: 'gsk-xxx',
        maxTokens: 500,
        temperature: 0.7,
        maxHistory: 30,
        timeout: { streamStart: 10000, total: 60000 },
        cache: { enabled: true, maxSize: 200, ttlMs: 600000 },
      },
      voice: { provider: 'elevenlabs' as const, apiKey: 'el-key', voiceId: 'voice-123', speed: 1.2, stability: 0.8 },
      browser: { headless: true, executablePath: '/usr/bin/chromium', proxy: 'http://proxy:8080', args: ['--no-sandbox'] },
      behavior: {
        autoRespond: true,
        silenceThreshold: 2.0,
        minSpeechDuration: 0.5,
        maxResponseLength: 500,
        respondToSelf: false,
        turnDelay: 1000,
      },
    }
    const result = validateConfig(config)
    expect(result.ai.maxTokens).toBe(500)
    expect(result.voice?.provider).toBe('elevenlabs')
    expect(result.browser?.headless).toBe(true)
    expect(result.behavior?.silenceThreshold).toBe(2.0)
  })

  // ---------------------------------------------------------------------------
  // Auth validation
  // ---------------------------------------------------------------------------

  it('should throw ConfigValidationError when neither token nor username/password provided', () => {
    const config = {
      auth: {},
      ai: { provider: 'openai', systemPrompt: 'Hi' },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
    try {
      validateConfig(config)
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError)
      const cve = err as ConfigValidationError
      expect(cve.code).toBe('CONFIG_INVALID')
      expect(cve.errors.length).toBeGreaterThan(0)
      expect(cve.errors.some((e) => e.includes('auth.token') || e.includes('auth.username'))).toBe(true)
    }
  })

  it('should throw when only username is provided without password', () => {
    const config = {
      auth: { username: 'user' },
      ai: { provider: 'openai', systemPrompt: 'Hi' },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
  })

  it('should reject invalid email format', () => {
    const config = {
      auth: { token: 'abc', email: 'not-an-email' },
      ai: { provider: 'openai', systemPrompt: 'Hi' },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
  })

  // ---------------------------------------------------------------------------
  // AI config validation
  // ---------------------------------------------------------------------------

  it('should throw when systemPrompt is empty', () => {
    const config = {
      auth: { token: 'abc' },
      ai: { provider: 'openai', systemPrompt: '' },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
  })

  it('should throw when provider is invalid', () => {
    const config = {
      auth: { token: 'abc' },
      ai: { provider: 'invalid-provider', systemPrompt: 'Hi' },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
  })

  it('should throw when temperature is out of range', () => {
    const config = {
      auth: { token: 'abc' },
      ai: { provider: 'openai', systemPrompt: 'Hi', temperature: 3.0 },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
  })

  it('should throw when temperature is negative', () => {
    const config = {
      auth: { token: 'abc' },
      ai: { provider: 'openai', systemPrompt: 'Hi', temperature: -1 },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
  })

  it('should throw when maxTokens is negative', () => {
    const config = {
      auth: { token: 'abc' },
      ai: { provider: 'openai', systemPrompt: 'Hi', maxTokens: -10 },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
  })

  it('should throw when maxTokens is not an integer', () => {
    const config = {
      auth: { token: 'abc' },
      ai: { provider: 'openai', systemPrompt: 'Hi', maxTokens: 10.5 },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
  })

  // ---------------------------------------------------------------------------
  // Voice config validation
  // ---------------------------------------------------------------------------

  it('should throw when voice provider is invalid', () => {
    const config = {
      auth: { token: 'abc' },
      ai: { provider: 'openai', systemPrompt: 'Hi' },
      voice: { provider: 'whisper' },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
  })

  it('should throw when speed is out of range', () => {
    const config = {
      auth: { token: 'abc' },
      ai: { provider: 'openai', systemPrompt: 'Hi' },
      voice: { provider: 'openai', speed: 10.0 },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
  })

  it('should throw when stability is out of range', () => {
    const config = {
      auth: { token: 'abc' },
      ai: { provider: 'openai', systemPrompt: 'Hi' },
      voice: { provider: 'elevenlabs', stability: 2.0 },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
  })

  // ---------------------------------------------------------------------------
  // Behavior config validation
  // ---------------------------------------------------------------------------

  it('should throw when silenceThreshold is not positive', () => {
    const config = {
      auth: { token: 'abc' },
      ai: { provider: 'openai', systemPrompt: 'Hi' },
      behavior: { silenceThreshold: 0 },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
  })

  it('should throw when turnDelay is negative', () => {
    const config = {
      auth: { token: 'abc' },
      ai: { provider: 'openai', systemPrompt: 'Hi' },
      behavior: { turnDelay: -100 },
    }
    expect(() => validateConfig(config)).toThrow(ConfigValidationError)
  })

  // ---------------------------------------------------------------------------
  // Missing config entirely
  // ---------------------------------------------------------------------------

  it('should throw on completely empty config', () => {
    expect(() => validateConfig({})).toThrow(ConfigValidationError)
  })

  it('should throw on null/undefined config', () => {
    expect(() => validateConfig(null)).toThrow(ConfigValidationError)
    expect(() => validateConfig(undefined)).toThrow(ConfigValidationError)
  })

  // ---------------------------------------------------------------------------
  // Error formatting
  // ---------------------------------------------------------------------------

  it('should format multiple errors with bullet points', () => {
    try {
      validateConfig({ auth: {}, ai: { provider: 'openai', systemPrompt: '' } })
    } catch (err) {
      const cve = err as ConfigValidationError
      expect(cve.message).toContain('Invalid configuration:')
      expect(cve.message).toContain('  - ')
      expect(cve.errors.length).toBeGreaterThan(0)
    }
  })

  // ---------------------------------------------------------------------------
  // AgentConfigSchema (direct Zod schema)
  // ---------------------------------------------------------------------------

  it('should expose AgentConfigSchema for direct safeParse usage', () => {
    const result = AgentConfigSchema.safeParse(validTokenConfig)
    expect(result.success).toBe(true)
  })

  it('should report failures via safeParse without throwing', () => {
    const result = AgentConfigSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})


