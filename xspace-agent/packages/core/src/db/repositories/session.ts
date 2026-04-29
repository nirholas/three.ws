// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Repository — Agent Sessions
// =============================================================================

import { eq, and, desc, sql } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { agentSessions } from '../schema'

export type AgentSession = typeof agentSessions.$inferSelect
export type NewAgentSession = typeof agentSessions.$inferInsert

export class SessionRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewAgentSession): Promise<AgentSession> {
    const [session] = await this.db.insert(agentSessions).values(data).returning()
    return session
  }

  async findById(id: string): Promise<AgentSession | undefined> {
    return this.db.query.agentSessions.findFirst({
      where: eq(agentSessions.id, id),
    })
  }

  async findByOrgId(orgId: string, limit = 50): Promise<AgentSession[]> {
    return this.db.query.agentSessions.findMany({
      where: eq(agentSessions.orgId, orgId),
      orderBy: [desc(agentSessions.startedAt)],
      limit,
    })
  }

  async findActive(orgId: string): Promise<AgentSession[]> {
    return this.db.query.agentSessions.findMany({
      where: and(
        eq(agentSessions.orgId, orgId),
        eq(agentSessions.status, 'active'),
      ),
    })
  }

  async end(id: string): Promise<AgentSession | undefined> {
    const session = await this.findById(id)
    if (!session) return undefined

    const endedAt = new Date()
    const durationSeconds = session.startedAt
      ? Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000)
      : 0

    const [updated] = await this.db
      .update(agentSessions)
      .set({ status: 'ended', endedAt, durationSeconds })
      .where(eq(agentSessions.id, id))
      .returning()
    return updated
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db
      .update(agentSessions)
      .set({ status })
      .where(eq(agentSessions.id, id))
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(agentSessions).where(eq(agentSessions.id, id))
  }

  async countByOrg(orgId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentSessions)
      .where(eq(agentSessions.orgId, orgId))
    return result[0]?.count ?? 0
  }
}


