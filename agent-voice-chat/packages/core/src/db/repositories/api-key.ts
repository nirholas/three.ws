// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Repository — API Keys
// =============================================================================

import { eq, and, lt, isNotNull, sql } from 'drizzle-orm'
import { createHash } from 'crypto'
import { getDatabase } from '../connection'
import { apiKeys } from '../schema'

export type ApiKey = typeof apiKeys.$inferSelect
export type NewApiKey = typeof apiKeys.$inferInsert

export class ApiKeyRepository {
  private get db() {
    return getDatabase()
  }

  /** Hash a raw API key for storage. */
  static hashKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex')
  }

  /** Extract the display prefix from a raw key. */
  static extractPrefix(rawKey: string): string {
    return rawKey.slice(0, 8)
  }

  async create(data: NewApiKey): Promise<ApiKey> {
    const [key] = await this.db.insert(apiKeys).values(data).returning()
    return key
  }

  async findByHash(keyHash: string): Promise<ApiKey | undefined> {
    return this.db.query.apiKeys.findFirst({
      where: and(
        eq(apiKeys.keyHash, keyHash),
        // Only return non-expired keys (null expiresAt = never expires)
      ),
    })
  }

  /** Validate a raw API key. Returns the key record if valid, undefined if not. */
  async validate(rawKey: string): Promise<ApiKey | undefined> {
    const hash = ApiKeyRepository.hashKey(rawKey)
    const key = await this.findByHash(hash)
    if (!key) return undefined

    // Check expiration
    if (key.expiresAt && key.expiresAt < new Date()) {
      return undefined
    }

    // Update last used timestamp (fire-and-forget)
    this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, key.id))
      .catch(() => {})

    return key
  }

  async findByOrgId(orgId: string): Promise<ApiKey[]> {
    return this.db.query.apiKeys.findMany({
      where: eq(apiKeys.orgId, orgId),
      orderBy: (k, { desc }) => [desc(k.createdAt)],
    })
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(apiKeys).where(eq(apiKeys.id, id))
  }

  async deleteExpired(): Promise<number> {
    const result = await this.db
      .delete(apiKeys)
      .where(and(
        isNotNull(apiKeys.expiresAt),
        lt(apiKeys.expiresAt, sql`NOW()`),
      ))
      .returning()
    return result.length
  }
}


