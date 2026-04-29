// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Repository — Conversation Analytics
// =============================================================================

import { eq, and, gte, lte, desc, sql, avg, min, max, count } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { conversationAnalytics, sentimentTimeseries } from '../schema'

export type ConversationAnalyticsRow = typeof conversationAnalytics.$inferSelect
export type NewConversationAnalytics = typeof conversationAnalytics.$inferInsert
export type SentimentTimeseriesRow = typeof sentimentTimeseries.$inferSelect
export type NewSentimentTimeseries = typeof sentimentTimeseries.$inferInsert

export class AnalyticsRepository {
  private get db() {
    return getDatabase()
  }

  // ---------------------------------------------------------------------------
  // Conversation Analytics CRUD
  // ---------------------------------------------------------------------------

  async upsertSessionAnalytics(data: NewConversationAnalytics): Promise<ConversationAnalyticsRow> {
    // If analytics already exist for this session, update them
    if (data.sessionId) {
      const existing = await this.db
        .select()
        .from(conversationAnalytics)
        .where(eq(conversationAnalytics.sessionId, data.sessionId))
        .limit(1)

      if (existing.length > 0) {
        const [updated] = await this.db
          .update(conversationAnalytics)
          .set({ ...data, processedAt: new Date() })
          .where(eq(conversationAnalytics.id, existing[0].id))
          .returning()
        return updated
      }
    }

    const [created] = await this.db.insert(conversationAnalytics).values(data).returning()
    return created
  }

  async getBySessionId(sessionId: string): Promise<ConversationAnalyticsRow | null> {
    const [row] = await this.db
      .select()
      .from(conversationAnalytics)
      .where(eq(conversationAnalytics.sessionId, sessionId))
      .limit(1)
    return row ?? null
  }

  async getByOrgId(orgId: string, options?: {
    limit?: number
    offset?: number
    since?: Date
    until?: Date
    minSentiment?: number
    maxSentiment?: number
  }): Promise<{ rows: ConversationAnalyticsRow[]; total: number }> {
    const conditions = [eq(conversationAnalytics.orgId, orgId)]
    if (options?.since) conditions.push(gte(conversationAnalytics.processedAt, options.since))
    if (options?.until) conditions.push(lte(conversationAnalytics.processedAt, options.until))

    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0

    const [rows, countResult] = await Promise.all([
      this.db
        .select()
        .from(conversationAnalytics)
        .where(and(...conditions))
        .orderBy(desc(conversationAnalytics.processedAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(conversationAnalytics)
        .where(and(...conditions)),
    ])

    return { rows, total: Number(countResult[0]?.count ?? 0) }
  }

  async getAggregateStats(orgId: string, options?: {
    since?: Date
    until?: Date
    agentId?: string
  }): Promise<{
    totalSessions: number
    avgSentiment: number | null
    avgDuration: number | null
    avgParticipants: number | null
    totalTurns: number | null
    sentimentMin: number | null
    sentimentMax: number | null
  }> {
    const conditions = [eq(conversationAnalytics.orgId, orgId)]
    if (options?.since) conditions.push(gte(conversationAnalytics.processedAt, options.since))
    if (options?.until) conditions.push(lte(conversationAnalytics.processedAt, options.until))

    const [result] = await this.db
      .select({
        totalSessions: count(),
        avgSentiment: avg(conversationAnalytics.sentimentAvg),
        avgDuration: avg(conversationAnalytics.durationSeconds),
        avgParticipants: avg(conversationAnalytics.participantCount),
        totalTurns: sql<number>`sum(${conversationAnalytics.totalTurns})`,
        sentimentMin: min(conversationAnalytics.sentimentMin),
        sentimentMax: max(conversationAnalytics.sentimentMax),
      })
      .from(conversationAnalytics)
      .where(and(...conditions))

    return {
      totalSessions: Number(result.totalSessions),
      avgSentiment: result.avgSentiment ? Number(result.avgSentiment) : null,
      avgDuration: result.avgDuration ? Number(result.avgDuration) : null,
      avgParticipants: result.avgParticipants ? Number(result.avgParticipants) : null,
      totalTurns: result.totalTurns ? Number(result.totalTurns) : null,
      sentimentMin: result.sentimentMin ? Number(result.sentimentMin) : null,
      sentimentMax: result.sentimentMax ? Number(result.sentimentMax) : null,
    }
  }

  async deleteBySessionId(sessionId: string): Promise<void> {
    await this.db
      .delete(conversationAnalytics)
      .where(eq(conversationAnalytics.sessionId, sessionId))
  }

  // ---------------------------------------------------------------------------
  // Sentiment Timeseries
  // ---------------------------------------------------------------------------

  async insertSentimentPoint(data: NewSentimentTimeseries): Promise<SentimentTimeseriesRow> {
    const [row] = await this.db.insert(sentimentTimeseries).values(data).returning()
    return row
  }

  async insertSentimentBatch(data: NewSentimentTimeseries[]): Promise<void> {
    if (data.length === 0) return
    await this.db.insert(sentimentTimeseries).values(data)
  }

  async getSentimentTimeseries(sessionId: string, options?: {
    speaker?: string
    since?: Date
    until?: Date
  }): Promise<SentimentTimeseriesRow[]> {
    const conditions = [eq(sentimentTimeseries.sessionId, sessionId)]
    if (options?.speaker) conditions.push(eq(sentimentTimeseries.speaker, options.speaker))
    if (options?.since) conditions.push(gte(sentimentTimeseries.timestamp, options.since))
    if (options?.until) conditions.push(lte(sentimentTimeseries.timestamp, options.until))

    return this.db
      .select()
      .from(sentimentTimeseries)
      .where(and(...conditions))
      .orderBy(sentimentTimeseries.timestamp)
  }

  async deleteSentimentBySessionId(sessionId: string): Promise<void> {
    await this.db
      .delete(sentimentTimeseries)
      .where(eq(sentimentTimeseries.sessionId, sessionId))
  }
}


