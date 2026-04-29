// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§87]

// =============================================================================
// Repository — Audit Logs (Enhanced for Compliance)
// =============================================================================

import { eq, and, gte, lte, desc, sql, isNull } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { auditLogs } from '../schema'

export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert

export class AuditRepository {
  private get db() {
    return getDatabase()
  }

  async log(data: NewAuditLog): Promise<AuditLog> {
    const [entry] = await this.db.insert(auditLogs).values(data).returning()
    return entry
  }

  async findByOrgId(orgId: string, options?: {
    limit?: number
    since?: Date
    until?: Date
    action?: string
    severity?: string
    actorId?: string
    resourceType?: string
    resourceId?: string
    page?: number
  }): Promise<{ entries: AuditLog[]; total: number }> {
    const conditions = [eq(auditLogs.orgId, orgId)]
    if (options?.since) conditions.push(gte(auditLogs.createdAt, options.since))
    if (options?.until) conditions.push(lte(auditLogs.createdAt, options.until))
    if (options?.action) conditions.push(eq(auditLogs.action, options.action))
    if (options?.severity) conditions.push(eq(auditLogs.severity, options.severity))
    if (options?.actorId) conditions.push(eq(auditLogs.actorId, options.actorId))
    if (options?.resourceType) conditions.push(eq(auditLogs.resourceType, options.resourceType))
    if (options?.resourceId) conditions.push(eq(auditLogs.resourceId, options.resourceId))

    const limit = options?.limit ?? 50
    const page = options?.page ?? 1
    const offset = (page - 1) * limit

    const [entries, countResult] = await Promise.all([
      this.db.query.auditLogs.findMany({
        where: and(...conditions),
        orderBy: [desc(auditLogs.createdAt)],
        limit,
        offset,
      }),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(auditLogs)
        .where(and(...conditions)),
    ])

    return { entries, total: Number(countResult[0]?.count ?? 0) }
  }

  async findByResourceId(resourceId: string): Promise<AuditLog[]> {
    return this.db.query.auditLogs.findMany({
      where: eq(auditLogs.resourceId, resourceId),
      orderBy: [desc(auditLogs.createdAt)],
    })
  }

  async findByActorId(actorId: string, limit = 100): Promise<AuditLog[]> {
    return this.db.query.auditLogs.findMany({
      where: eq(auditLogs.actorId, actorId),
      orderBy: [desc(auditLogs.createdAt)],
      limit,
    })
  }

  /**
   * Get the hash chain for an org (ordered ascending by created_at).
   */
  async getChain(orgId: string, startDate?: Date, endDate?: Date): Promise<AuditLog[]> {
    const conditions = [eq(auditLogs.orgId, orgId)]
    if (startDate) conditions.push(gte(auditLogs.createdAt, startDate))
    if (endDate) conditions.push(lte(auditLogs.createdAt, endDate))

    return this.db.query.auditLogs.findMany({
      where: and(...conditions),
      orderBy: [auditLogs.createdAt], // ascending for chain verification
    })
  }

  /**
   * Get the most recent entry hash for an org (for chain linking).
   */
  async getLastHash(orgId: string): Promise<string | null> {
    const [last] = await this.db.query.auditLogs.findMany({
      where: eq(auditLogs.orgId, orgId),
      orderBy: [desc(auditLogs.createdAt)],
      limit: 1,
      columns: { entryHash: true },
    })
    return last?.entryHash ?? null
  }

  /**
   * Delete entries by action type before a cutoff date (retention enforcement).
   */
  async deleteByAction(action: string, before: Date): Promise<number> {
    const result = await this.db
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.action, action),
          lte(auditLogs.createdAt, before),
        ),
      )
      .returning({ id: auditLogs.id })
    return result.length
  }

  /**
   * Anonymize PII in audit logs for a specific actor (GDPR deletion).
   */
  async anonymizeActor(orgId: string, actorId: string): Promise<number> {
    const result = await this.db
      .update(auditLogs)
      .set({
        actorId: null,
        actorIp: null,
        actorUserAgent: null,
      })
      .where(
        and(
          eq(auditLogs.orgId, orgId),
          eq(auditLogs.actorId, actorId),
        ),
      )
      .returning({ id: auditLogs.id })
    return result.length
  }

  /**
   * Get aggregated summary statistics.
   */
  async getSummary(orgId: string, startDate: Date, endDate: Date): Promise<{
    total: number
    byAction: Record<string, number>
    bySeverity: Record<string, number>
  }> {
    const conditions = and(
      eq(auditLogs.orgId, orgId),
      gte(auditLogs.createdAt, startDate),
      lte(auditLogs.createdAt, endDate),
    )

    const [actionCounts, severityCounts, totalResult] = await Promise.all([
      this.db
        .select({
          action: auditLogs.action,
          count: sql<number>`count(*)`,
        })
        .from(auditLogs)
        .where(conditions)
        .groupBy(auditLogs.action),
      this.db
        .select({
          severity: auditLogs.severity,
          count: sql<number>`count(*)`,
        })
        .from(auditLogs)
        .where(conditions)
        .groupBy(auditLogs.severity),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(auditLogs)
        .where(conditions),
    ])

    const byAction: Record<string, number> = {}
    for (const row of actionCounts) {
      byAction[row.action] = Number(row.count)
    }

    const bySeverity: Record<string, number> = {}
    for (const row of severityCounts) {
      bySeverity[row.severity] = Number(row.count)
    }

    return {
      total: Number(totalResult[0]?.count ?? 0),
      byAction,
      bySeverity,
    }
  }
}


