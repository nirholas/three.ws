// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Repository — Impersonation Sessions
// =============================================================================

import { eq, and, gt } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { impersonationSessions } from '../schema'

export type ImpersonationSessionRow = typeof impersonationSessions.$inferSelect
export type NewImpersonationSession = typeof impersonationSessions.$inferInsert

export class ImpersonationSessionRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewImpersonationSession): Promise<ImpersonationSessionRow> {
    const [session] = await this.db.insert(impersonationSessions).values(data).returning()
    return session
  }

  async findById(id: string): Promise<ImpersonationSessionRow | undefined> {
    return this.db.query.impersonationSessions.findFirst({
      where: eq(impersonationSessions.id, id),
    })
  }

  async findActive(adminUserId: string, targetOrgId: string): Promise<ImpersonationSessionRow | undefined> {
    const results = await this.db
      .select()
      .from(impersonationSessions)
      .where(
        and(
          eq(impersonationSessions.adminUserId, adminUserId),
          eq(impersonationSessions.targetOrgId, targetOrgId),
          gt(impersonationSessions.expiresAt, new Date()),
        ),
      )
      .limit(1)
    return results[0]
  }

  async findByResellerId(resellerId: string): Promise<ImpersonationSessionRow[]> {
    return this.db.query.impersonationSessions.findMany({
      where: eq(impersonationSessions.resellerId, resellerId),
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    })
  }

  async findActiveByAdmin(adminUserId: string): Promise<ImpersonationSessionRow[]> {
    return this.db
      .select()
      .from(impersonationSessions)
      .where(
        and(
          eq(impersonationSessions.adminUserId, adminUserId),
          gt(impersonationSessions.expiresAt, new Date()),
        ),
      )
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(impersonationSessions).where(eq(impersonationSessions.id, id))
  }
}


