// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§76]

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(),
}))

const mockPromptAuth = vi.hoisted(() => vi.fn())

vi.mock('fs', () => ({
  ...mockFs,
  default: mockFs,
}))

vi.mock('../../src/prompts', () => ({
  promptAuth: mockPromptAuth,
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

import { authCommand } from '../../src/commands/auth'
import { success, error as logError } from '../../src/logger'

// ── Tests ───────────────────────────────────────────────────────────────────

describe('authCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as any)
  })

  // ── Token auth flow ───────────────────────────────────────────────────

  describe('token auth', () => {
    it('creates new .env with auth token when no .env exists', async () => {
      mockPromptAuth.mockResolvedValue({
        method: 'token',
        authToken: 'valid-auth-token-value-1234567890',
      })
      mockFs.existsSync.mockReturnValue(false)

      await authCommand({ config: 'xspace.config.json' })

      expect(mockFs.writeFileSync).toHaveBeenCalledOnce()
      const [, content] = mockFs.writeFileSync.mock.calls[0]
      expect(content).toContain('X_AUTH_TOKEN=valid-auth-token-value-1234567890')
      expect(success).toHaveBeenCalledWith('auth_token saved to .env')
    })

    it('appends token to existing .env that has no X_AUTH_TOKEN', async () => {
      mockPromptAuth.mockResolvedValue({
        method: 'token',
        authToken: 'new-token-12345678',
      })
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('OPENAI_API_KEY=sk-existing\n')

      await authCommand({ config: 'xspace.config.json' })

      const [, content] = mockFs.writeFileSync.mock.calls[0]
      expect(content).toContain('OPENAI_API_KEY=sk-existing')
      expect(content).toContain('X_AUTH_TOKEN=new-token-12345678')
    })

    it('replaces existing X_AUTH_TOKEN in .env', async () => {
      mockPromptAuth.mockResolvedValue({
        method: 'token',
        authToken: 'updated-token-1234',
      })
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('X_AUTH_TOKEN=old-token\nOTHER=value\n')

      await authCommand({ config: 'xspace.config.json' })

      const [, content] = mockFs.writeFileSync.mock.calls[0]
      expect(content).toContain('X_AUTH_TOKEN=updated-token-1234')
      expect(content).not.toContain('old-token')
      expect(content).toContain('OTHER=value')
    })

    it('exits with error if token is too short', async () => {
      mockPromptAuth.mockResolvedValue({
        method: 'token',
        authToken: 'short',
      })
      mockFs.existsSync.mockReturnValue(false)

      await expect(authCommand({ config: 'xspace.config.json' })).rejects.toThrow('process.exit(1)')

      expect(logError).toHaveBeenCalledWith(
        'The auth_token seems invalid. Get a fresh one from browser DevTools.'
      )
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('appends newline before token when existing env does not end with newline', async () => {
      mockPromptAuth.mockResolvedValue({
        method: 'token',
        authToken: 'token-value-for-testing',
      })
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('SOME_VAR=value') // no trailing newline

      await authCommand({ config: 'xspace.config.json' })

      const [, content] = mockFs.writeFileSync.mock.calls[0]
      expect(content).toBe('SOME_VAR=value\nX_AUTH_TOKEN=token-value-for-testing\n')
    })
  })

  // ── Username/password auth flow ───────────────────────────────────────

  describe('credentials auth', () => {
    it('saves username and password to .env', async () => {
      mockPromptAuth.mockResolvedValue({
        method: 'credentials',
        username: 'testuser',
        password: 'testpass123',
      })
      mockFs.existsSync.mockReturnValue(false)

      await authCommand({ config: 'xspace.config.json' })

      const [, content] = mockFs.writeFileSync.mock.calls[0]
      expect(content).toContain('X_USERNAME=testuser')
      expect(content).toContain('X_PASSWORD=testpass123')
      expect(success).toHaveBeenCalledWith('Credentials saved to .env')
    })

    it('replaces existing credentials in .env', async () => {
      mockPromptAuth.mockResolvedValue({
        method: 'credentials',
        username: 'newuser',
        password: 'newpass',
      })
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('X_USERNAME=olduser\nX_PASSWORD=oldpass\n')

      await authCommand({ config: 'xspace.config.json' })

      const [, content] = mockFs.writeFileSync.mock.calls[0]
      expect(content).toContain('X_USERNAME=newuser')
      expect(content).toContain('X_PASSWORD=newpass')
      expect(content).not.toContain('olduser')
      expect(content).not.toContain('oldpass')
    })
  })

  // ── Error handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('catches prompt errors and exits with code 1', async () => {
      mockPromptAuth.mockRejectedValue(new Error('Prompt was force closed'))

      await expect(authCommand({ config: 'xspace.config.json' })).rejects.toThrow('process.exit(1)')

      expect(logError).toHaveBeenCalledWith('Authentication failed:', 'Prompt was force closed')
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('handles non-Error rejections', async () => {
      mockPromptAuth.mockRejectedValue('unexpected')

      await expect(authCommand({ config: 'xspace.config.json' })).rejects.toThrow('process.exit(1)')

      expect(logError).toHaveBeenCalledWith('Authentication failed:', 'unexpected')
    })
  })
})


