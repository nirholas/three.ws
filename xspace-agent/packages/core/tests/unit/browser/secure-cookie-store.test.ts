// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Mock logger before importing the module under test
vi.mock('../../../src/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { SecureCookieStore } from '../../../src/browser/secure-cookie-store'

describe('SecureCookieStore', () => {
  const password = 'test-encryption-password-123'
  let store: SecureCookieStore
  let tmpDir: string
  let cookiePath: string

  const sampleCookies = [
    { name: 'auth_token', value: 'abc123', domain: '.x.com' },
    { name: 'ct0', value: 'csrf-token-456', domain: '.x.com' },
  ]

  beforeEach(() => {
    store = new SecureCookieStore(password)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-test-'))
    cookiePath = path.join(tmpDir, 'cookies.json')
  })

  afterEach(() => {
    // Clean up temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  // ── Save ───────────────────────────────────────────────────

  describe('save()', () => {
    it('should write an encrypted file to disk', async () => {
      await store.save(sampleCookies, cookiePath)

      expect(fs.existsSync(cookiePath)).toBe(true)

      const raw = fs.readFileSync(cookiePath, 'utf-8')
      const parsed = JSON.parse(raw)

      // The encrypted payload has iv, tag, and data fields
      expect(parsed).toHaveProperty('iv')
      expect(parsed).toHaveProperty('tag')
      expect(parsed).toHaveProperty('data')
    })

    it('should not store cookies in plaintext', async () => {
      await store.save(sampleCookies, cookiePath)

      const raw = fs.readFileSync(cookiePath, 'utf-8')

      // The cookie values must not appear in the raw file contents
      expect(raw).not.toContain('abc123')
      expect(raw).not.toContain('csrf-token-456')
      expect(raw).not.toContain('auth_token')
    })

    it('should produce different ciphertext on each save (random IV)', async () => {
      await store.save(sampleCookies, cookiePath)
      const first = fs.readFileSync(cookiePath, 'utf-8')

      await store.save(sampleCookies, cookiePath)
      const second = fs.readFileSync(cookiePath, 'utf-8')

      const firstParsed = JSON.parse(first)
      const secondParsed = JSON.parse(second)

      // IVs should differ (random)
      expect(firstParsed.iv).not.toBe(secondParsed.iv)
    })

    it('should set restrictive file permissions (0o600)', async () => {
      await store.save(sampleCookies, cookiePath)

      const stat = fs.statSync(cookiePath)
      // 0o600 = owner read/write only (octal 33024 decimal or mode & 0o777 === 0o600)
      const mode = stat.mode & 0o777
      expect(mode).toBe(0o600)
    })
  })

  // ── Load ───────────────────────────────────────────────────

  describe('load()', () => {
    it('should decrypt and return the original cookies', async () => {
      await store.save(sampleCookies, cookiePath)
      const loaded = await store.load(cookiePath)

      expect(loaded).toEqual(sampleCookies)
    })

    it('should handle empty arrays', async () => {
      await store.save([], cookiePath)
      const loaded = await store.load(cookiePath)

      expect(loaded).toEqual([])
    })

    it('should handle large cookie arrays', async () => {
      const largeCookies = Array.from({ length: 100 }, (_, i) => ({
        name: `cookie_${i}`,
        value: `value_${i}_${'x'.repeat(100)}`,
        domain: '.x.com',
      }))

      await store.save(largeCookies, cookiePath)
      const loaded = await store.load(cookiePath)

      expect(loaded).toEqual(largeCookies)
      expect(loaded).toHaveLength(100)
    })

    it('should support legacy plain-text cookie files (array JSON)', async () => {
      // Write a plain-text cookie file (legacy format)
      fs.writeFileSync(cookiePath, JSON.stringify(sampleCookies))

      const loaded = await store.load(cookiePath)
      expect(loaded).toEqual(sampleCookies)
    })
  })

  // ── Decryption with wrong password ─────────────────────────

  describe('decryption errors', () => {
    it('should fail to decrypt with a different password', async () => {
      await store.save(sampleCookies, cookiePath)

      const wrongStore = new SecureCookieStore('wrong-password')

      await expect(wrongStore.load(cookiePath)).rejects.toThrow()
    })

    it('should throw on corrupted ciphertext', async () => {
      await store.save(sampleCookies, cookiePath)

      // Corrupt the encrypted data
      const raw = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'))
      raw.data = 'deadbeef' + raw.data.slice(8)
      fs.writeFileSync(cookiePath, JSON.stringify(raw))

      await expect(store.load(cookiePath)).rejects.toThrow()
    })

    it('should throw on corrupted IV', async () => {
      await store.save(sampleCookies, cookiePath)

      const raw = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'))
      raw.iv = '00'.repeat(16)
      fs.writeFileSync(cookiePath, JSON.stringify(raw))

      await expect(store.load(cookiePath)).rejects.toThrow()
    })

    it('should throw on corrupted auth tag', async () => {
      await store.save(sampleCookies, cookiePath)

      const raw = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'))
      raw.tag = '00'.repeat(16)
      fs.writeFileSync(cookiePath, JSON.stringify(raw))

      await expect(store.load(cookiePath)).rejects.toThrow()
    })

    it('should throw on invalid JSON', async () => {
      fs.writeFileSync(cookiePath, 'not valid json at all')

      await expect(store.load(cookiePath)).rejects.toThrow(
        /Cookie file is not valid JSON/,
      )
    })

    it('should throw on encrypted envelope with missing fields', async () => {
      // An object that is not an array but lacks the expected fields
      fs.writeFileSync(cookiePath, JSON.stringify({ foo: 'bar' }))

      await expect(store.load(cookiePath)).rejects.toThrow(
        /not in the expected encrypted format/,
      )
    })
  })

  // ── Round-trip with different data types ───────────────────

  describe('round-trip integrity', () => {
    it('should preserve special characters in cookie values', async () => {
      const special = [
        { name: 'special', value: 'hello=world&foo=bar; path=/', domain: '.x.com' },
        { name: 'unicode', value: '\u00e9\u00e8\u00ea\u00eb', domain: '.x.com' },
      ]

      await store.save(special, cookiePath)
      const loaded = await store.load(cookiePath)
      expect(loaded).toEqual(special)
    })

    it('should preserve nested objects in cookies', async () => {
      const nested = [
        {
          name: 'complex',
          value: 'token-value',
          domain: '.x.com',
          extra: { nested: true, count: 42 },
        },
      ]

      await store.save(nested, cookiePath)
      const loaded = await store.load(cookiePath)
      expect(loaded).toEqual(nested)
    })
  })
})


