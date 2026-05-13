// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§70]

// =============================================================================
// Encrypted cookie persistence — AES-256-GCM at rest
// =============================================================================

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto'
import fs from 'fs'
import { getLogger } from '../logger'

interface EncryptedPayload {
  iv: string
  tag: string
  data: string
}

/**
 * Encrypts cookies with AES-256-GCM before writing them to disk and decrypts
 * them on load.  Falls back to plain-text read if the file is not encrypted
 * (migration path from older cookie files).
 */
export class SecureCookieStore {
  private key: Buffer
  private readonly algorithm = 'aes-256-gcm' as const

  constructor(password: string) {
    // Derive a 256-bit key from the user-supplied password
    this.key = scryptSync(password, 'xspace-cookie-salt', 32)
  }

  /** Encrypt and persist cookies to `filepath`. */
  async save(cookies: unknown[], filepath: string): Promise<void> {
    const iv = randomBytes(16)
    const cipher = createCipheriv(this.algorithm, this.key, iv)

    const plaintext = JSON.stringify(cookies)
    let encrypted = cipher.update(plaintext, 'utf-8', 'hex')
    encrypted += cipher.final('hex')
    const tag = cipher.getAuthTag()

    const payload: EncryptedPayload = {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted,
    }

    fs.writeFileSync(filepath, JSON.stringify(payload), { mode: 0o600 })
    getLogger().debug('[SecureCookieStore] Cookies saved (encrypted)')
  }

  /** Load and decrypt cookies from `filepath`. */
  async load(filepath: string): Promise<unknown[]> {
    const raw = fs.readFileSync(filepath, 'utf-8')
    let parsed: unknown

    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Cookie file is not valid JSON')
    }

    // If the file is an array it's a legacy plain-text cookie file — return as-is
    if (Array.isArray(parsed)) {
      getLogger().warn(
        '[SecureCookieStore] Legacy plain-text cookie file detected — will encrypt on next save',
      )
      return parsed
    }

    // Otherwise expect our encrypted envelope
    const { iv, tag, data } = parsed as EncryptedPayload
    if (!iv || !tag || !data) {
      throw new Error('Cookie file is not in the expected encrypted format')
    }

    const decipher = createDecipheriv(
      this.algorithm,
      this.key,
      Buffer.from(iv, 'hex'),
    )
    decipher.setAuthTag(Buffer.from(tag, 'hex'))

    let decrypted = decipher.update(data, 'hex', 'utf-8')
    decrypted += decipher.final('utf-8')

    return JSON.parse(decrypted) as unknown[]
  }
}


