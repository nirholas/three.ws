// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// API Gateway — API Key Service
// =============================================================================

import { randomBytes, createHash } from 'crypto'
import { ApiKeyRepository } from '../db/repositories/api-key'
import { getJSON, setJSON, getRedis } from '../db/redis'
import type { ApiKey } from '../db/repositories/api-key'
import type { ApiKeyEnvironment, ApiScope, ParsedApiKey } from './types'

const KEY_PREFIX = 'xsa'
const SECRET_LENGTH = 32
const KEY_CACHE_PREFIX = 'apikey:'
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000 // 24 hours

export class ApiKeyService {
  private repo = new ApiKeyRepository()

  /**
   * Generate a new API key string.
   * Format: xsa_{env}_{32-char hex random}
   */
  static generateKey(environment: ApiKeyEnvironment = 'live'): string {
    const secret = randomBytes(SECRET_LENGTH).toString('hex').slice(0, 32)
    return `${KEY_PREFIX}_${environment}_${secret}`
  }

  /** Hash a raw key with SHA-256 for storage. */
  static hashKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex')
  }

  /** Extract the display prefix (first 16 chars). */
  static extractPrefix(rawKey: string): string {
    // e.g., "xsa_live_k1a2b3c4" — prefix through first 8 chars of secret
    const parts = rawKey.split('_')
    if (parts.length < 3) return rawKey.slice(0, 16)
    return `${parts[0]}_${parts[1]}_${parts[2].slice(0, 8)}`
  }

  /** Parse a raw key into its components. */
  static parseKey(rawKey: string): ParsedApiKey | null {
    const match = rawKey.match(/^(xsa)_(live|test)_([a-f0-9]{32})$/)
    if (!match) return null
    return {
      prefix: match[1],
      environment: match[2] as ApiKeyEnvironment,
      secret: match[3],
      raw: rawKey,
    }
  }

  /** Create a new API key for an organization. */
  async create(opts: {
    orgId: string
    name: string
    scopes: ApiScope[]
    rateLimit?: number
    expiresAt?: Date
    environment?: ApiKeyEnvironment
  }): Promise<{ record: ApiKey; rawKey: string }> {
    const rawKey = ApiKeyService.generateKey(opts.environment ?? 'live')
    const keyHash = ApiKeyService.hashKey(rawKey)
    const keyPrefix = ApiKeyService.extractPrefix(rawKey)

    const record = await this.repo.create({
      orgId: opts.orgId,
      keyHash,
      keyPrefix,
      name: opts.name,
      scopes: opts.scopes,
      rateLimit: opts.rateLimit ?? 1000,
      expiresAt: opts.expiresAt ?? null,
    })

    return { record, rawKey }
  }

  /**
   * Validate a raw API key.
   * Checks Redis cache first, falls back to database.
   * Returns the key record if valid, null if invalid/expired/revoked.
   */
  async validate(rawKey: string, cacheTtlSeconds = 300): Promise<ApiKey | null> {
    const keyHash = ApiKeyService.hashKey(rawKey)
    const cacheKey = `${KEY_CACHE_PREFIX}${keyHash}`

    // Check cache first
    const cached = await getJSON<ApiKey>(cacheKey).catch(() => null)
    if (cached) {
      // Still verify expiration on cached entries
      if (cached.expiresAt && new Date(cached.expiresAt) < new Date()) {
        await this.invalidateCache(keyHash)
        return null
      }
      return cached
    }

    // Fall back to database
    const key = await this.repo.validate(rawKey)
    if (!key) return null

    // Cache the result
    await setJSON(cacheKey, key, cacheTtlSeconds).catch(() => {})

    return key
  }

  /** List all API keys for an organization (never returns hashes). */
  async listByOrg(orgId: string): Promise<ApiKey[]> {
    return this.repo.findByOrgId(orgId)
  }

  /** Get a single key by ID (for the owning org). */
  async findById(id: string, orgId: string): Promise<ApiKey | undefined> {
    const keys = await this.repo.findByOrgId(orgId)
    return keys.find((k) => k.id === id)
  }

  /** Update key metadata (name, scopes, rate limit). */
  async update(
    id: string,
    orgId: string,
    updates: { name?: string; scopes?: ApiScope[]; rateLimit?: number },
  ): Promise<ApiKey | null> {
    const key = await this.findById(id, orgId)
    if (!key) return null

    // Invalidate cache before updating
    await this.invalidateCache(key.keyHash)

    // Update via direct DB (the repo doesn't have an update method, so we use the raw approach)
    const { getDatabase } = await import('../db/connection')
    const { apiKeys } = await import('../db/schema')
    const { eq, and } = await import('drizzle-orm')

    const db = getDatabase()
    const [updated] = await db
      .update(apiKeys)
      .set({
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.scopes !== undefined && { scopes: updates.scopes }),
        ...(updates.rateLimit !== undefined && { rateLimit: updates.rateLimit }),
      })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, orgId)))
      .returning()

    return updated ?? null
  }

  /** Revoke (delete) an API key immediately. */
  async revoke(id: string, orgId: string): Promise<boolean> {
    const key = await this.findById(id, orgId)
    if (!key) return false

    await this.invalidateCache(key.keyHash)
    await this.repo.delete(id)
    return true
  }

  /**
   * Rotate an API key: create a new key, keep the old one valid for 24h.
   * Returns the new key (shown once) and the grace period expiration.
   */
  async rotate(
    id: string,
    orgId: string,
  ): Promise<{ newRecord: ApiKey; rawKey: string; previousKeyValidUntil: Date } | null> {
    const oldKey = await this.findById(id, orgId)
    if (!oldKey) return null

    // Create the new key with same scopes/rate limit
    const { record: newRecord, rawKey } = await this.create({
      orgId,
      name: oldKey.name,
      scopes: (oldKey.scopes ?? []) as ApiScope[],
      rateLimit: oldKey.rateLimit ?? 1000,
    })

    // Set old key to expire after grace period
    const previousKeyValidUntil = new Date(Date.now() + GRACE_PERIOD_MS)
    const { getDatabase } = await import('../db/connection')
    const { apiKeys } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')

    const db = getDatabase()
    await db
      .update(apiKeys)
      .set({ expiresAt: previousKeyValidUntil })
      .where(eq(apiKeys.id, id))

    // Invalidate old key cache
    await this.invalidateCache(oldKey.keyHash)

    return { newRecord, rawKey, previousKeyValidUntil }
  }

  /** Remove a cached key lookup from Redis. */
  private async invalidateCache(keyHash: string): Promise<void> {
    try {
      const redis = getRedis()
      await redis.del(`${KEY_CACHE_PREFIX}${keyHash}`)
    } catch {
      // Redis may not be available; cache miss is acceptable
    }
  }
}


