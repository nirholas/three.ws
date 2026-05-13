// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import { describe, it, expect, afterEach } from 'vitest'
import { SecureCookieStore } from '../browser/secure-cookie-store'
import { redactSecrets } from '../logger'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ---------------------------------------------------------------------------
// SecureCookieStore
// ---------------------------------------------------------------------------

describe('SecureCookieStore', () => {
  const tmpDir = os.tmpdir()
  const testFile = path.join(tmpDir, `test-cookies-${Date.now()}.json`)

  const sampleCookies = [
    { name: 'auth_token', value: 'abc123', domain: '.x.com' },
    { name: 'ct0', value: 'csrf456', domain: '.x.com' },
  ]

  afterEach(() => {
    try {
      fs.unlinkSync(testFile)
    } catch {
      // ignore
    }
  })

  it('encrypts and decrypts cookies round-trip', async () => {
    const store = new SecureCookieStore('test-password-123')
    await store.save(sampleCookies, testFile)

    // File on disk should NOT contain plain-text cookie values
    const raw = fs.readFileSync(testFile, 'utf-8')
    expect(raw).not.toContain('abc123')
    expect(raw).not.toContain('csrf456')

    // Parse the envelope
    const envelope = JSON.parse(raw)
    expect(envelope).toHaveProperty('iv')
    expect(envelope).toHaveProperty('tag')
    expect(envelope).toHaveProperty('data')

    // Decrypt and verify
    const loaded = await store.load(testFile)
    expect(loaded).toEqual(sampleCookies)
  })

  it('rejects decryption with wrong password', async () => {
    const store1 = new SecureCookieStore('correct-password')
    await store1.save(sampleCookies, testFile)

    const store2 = new SecureCookieStore('wrong-password')
    await expect(store2.load(testFile)).rejects.toThrow()
  })

  it('loads legacy plain-text cookie files gracefully', async () => {
    // Write a plain-text array (legacy format)
    fs.writeFileSync(testFile, JSON.stringify(sampleCookies))

    const store = new SecureCookieStore('any-password')
    const loaded = await store.load(testFile)
    expect(loaded).toEqual(sampleCookies)
  })

  it('sets restrictive file permissions (0o600)', async () => {
    const store = new SecureCookieStore('test-password')
    await store.save(sampleCookies, testFile)

    const stat = fs.statSync(testFile)
    // 0o600 = owner read + write only
    const mode = stat.mode & 0o777
    expect(mode).toBe(0o600)
  })
})

// ---------------------------------------------------------------------------
// redactSecrets
// ---------------------------------------------------------------------------

describe('redactSecrets', () => {
  it('redacts OpenAI API keys', () => {
    const input = 'Error: OPENAI_API_KEY=sk-abc123def456ghi789jklmnopqrstuvwxyz is invalid'
    const result = redactSecrets(input)
    expect(result).not.toContain('sk-abc123def456ghi789jklmnopqrstuvwxyz')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts Anthropic API keys', () => {
    const input = 'Using key sk-ant-api03-abcdefghijklmnopqrstuvwxyz'
    const result = redactSecrets(input)
    expect(result).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts Groq API keys', () => {
    const input = 'API key: gsk_abcdefghijklmnopqrstuvwxyz1234567890'
    const result = redactSecrets(input)
    expect(result).not.toContain('gsk_abcdefghijklmnopqrstuvwxyz1234567890')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts X auth tokens in env assignments', () => {
    const input = 'X_AUTH_TOKEN=a1b2c3d4e5f6a7b8c9d0'
    const result = redactSecrets(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('a1b2c3d4e5f6a7b8c9d0')
  })

  it('redacts ADMIN_API_KEY assignments', () => {
    const input = 'Config: ADMIN_API_KEY=my-secret-admin-key-value'
    const result = redactSecrets(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('my-secret-admin-key-value')
  })

  it('leaves non-secret text unchanged', () => {
    const input = 'Agent joined Space: https://x.com/i/spaces/abc123'
    const result = redactSecrets(input)
    expect(result).toBe(input)
  })

  it('handles multiple secrets in one string', () => {
    const input =
      'Keys: OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz and GROQ_API_KEY=gsk_abcdefghijklmnopqrstuvwxyz1234567890'
    const result = redactSecrets(input)
    expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
    expect(result).not.toContain('gsk_abcdefghijklmnopqrstuvwxyz1234567890')
    // Should have two redactions
    expect(result.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('is idempotent (double-redaction is safe)', () => {
    const input = 'Key: sk-abcdefghijklmnopqrstuvwxyz'
    const once = redactSecrets(input)
    const twice = redactSecrets(once)
    expect(once).toBe(twice)
  })
})


