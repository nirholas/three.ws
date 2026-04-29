// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Repository — Usage Records
// =============================================================================

import { eq, and, gte, lte, sql } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { usageRecords } from '../schema'

export type UsageRecord = typeof usageRecords.$inferSelect
export type NewUsageRecord = typeof usageRecords.$inferInsert

export interface UsageAggregate {
  metric: string
  totalQuantity: number
  totalCostCents: number
}

export class UsageRepository {
  private get db() {
    return getDatabase()
  }

  async record(data: NewUsageRecord): Promise<UsageRecord> {
    const [record] = await this.db.insert(usageRecords).values(data).returning()
    return record
  }

  async recordBatch(records: NewUsageRecord[]): Promise<void> {
    if (records.length === 0) return
    await this.db.insert(usageRecords).values(records)
  }

  async findByOrgId(orgId: string, limit = 100): Promise<UsageRecord[]> {
    return this.db.query.usageRecords.findMany({
      where: eq(usageRecords.orgId, orgId),
      orderBy: (r, { desc }) => [desc(r.recordedAt)],
      limit,
    })
  }

  async findBySessionId(sessionId: string): Promise<UsageRecord[]> {
    return this.db.query.usageRecords.findMany({
      where: eq(usageRecords.sessionId, sessionId),
      orderBy: (r, { desc }) => [desc(r.recordedAt)],
    })
  }

  async aggregateByOrg(orgId: string, since?: Date): Promise<UsageAggregate[]> {
    const conditions = [eq(usageRecords.orgId, orgId)]
    if (since) {
      conditions.push(gte(usageRecords.recordedAt, since))
    }

    const result = await this.db
      .select({
        metric: usageRecords.metric,
        totalQuantity: sql<number>`sum(${usageRecords.quantity})::int`,
        totalCostCents: sql<number>`coalesce(sum(${usageRecords.unitCostCents}), 0)::int`,
      })
      .from(usageRecords)
      .where(and(...conditions))
      .groupBy(usageRecords.metric)

    return result
  }

  async aggregateBySession(sessionId: string): Promise<UsageAggregate[]> {
    const result = await this.db
      .select({
        metric: usageRecords.metric,
        totalQuantity: sql<number>`sum(${usageRecords.quantity})::int`,
        totalCostCents: sql<number>`coalesce(sum(${usageRecords.unitCostCents}), 0)::int`,
      })
      .from(usageRecords)
      .where(eq(usageRecords.sessionId, sessionId))
      .groupBy(usageRecords.metric)

    return result
  }

  async getByOrgAndPeriod(orgId: string, start: Date, end: Date): Promise<UsageRecord[]> {
    return this.db.query.usageRecords.findMany({
      where: and(
        eq(usageRecords.orgId, orgId),
        gte(usageRecords.recordedAt, start),
        lte(usageRecords.recordedAt, end),
      ),
      orderBy: (r, { desc }) => [desc(r.recordedAt)],
    })
  }

  async createAggregate(data: {
    orgId: string
    metric: string
    quantity: number
    periodStart: Date
    periodEnd: Date
  }): Promise<void> {
    await this.db.insert(usageRecords).values({
      orgId: data.orgId,
      metric: data.metric,
      quantity: data.quantity,
      recordedAt: data.periodStart,
    })
  }
}


