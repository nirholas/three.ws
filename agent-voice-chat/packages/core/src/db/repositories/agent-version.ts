// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// =============================================================================
// Repository — Agent Versions (CI/CD)
// =============================================================================

import { eq, and, desc } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { agentVersions } from '../schema'

export type AgentVersion = typeof agentVersions.$inferSelect
export type NewAgentVersion = typeof agentVersions.$inferInsert

export type VersionStatus = 'draft' | 'testing' | 'staging' | 'production' | 'archived'

export class AgentVersionRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewAgentVersion): Promise<AgentVersion> {
    const [version] = await this.db.insert(agentVersions).values(data).returning()
    return version
  }

  async findById(id: string): Promise<AgentVersion | undefined> {
    return this.db.query.agentVersions.findFirst({
      where: eq(agentVersions.id, id),
    })
  }

  async findByAgentId(agentId: string): Promise<AgentVersion[]> {
    return this.db.query.agentVersions.findMany({
      where: eq(agentVersions.agentId, agentId),
      orderBy: [desc(agentVersions.version)],
    })
  }

  async findByAgentAndVersion(agentId: string, version: number): Promise<AgentVersion | undefined> {
    return this.db.query.agentVersions.findFirst({
      where: and(
        eq(agentVersions.agentId, agentId),
        eq(agentVersions.version, version),
      ),
    })
  }

  async findByStatus(agentId: string, status: VersionStatus): Promise<AgentVersion[]> {
    return this.db.query.agentVersions.findMany({
      where: and(
        eq(agentVersions.agentId, agentId),
        eq(agentVersions.status, status),
      ),
      orderBy: [desc(agentVersions.version)],
    })
  }

  async getLatestVersion(agentId: string): Promise<number> {
    const latest = await this.db.query.agentVersions.findFirst({
      where: eq(agentVersions.agentId, agentId),
      orderBy: [desc(agentVersions.version)],
    })
    return latest?.version ?? 0
  }

  async updateStatus(id: string, status: VersionStatus): Promise<AgentVersion | undefined> {
    const updates: Partial<NewAgentVersion> = { status }
    if (status === 'production') {
      updates.promotedAt = new Date()
    }
    const [version] = await this.db
      .update(agentVersions)
      .set(updates)
      .where(eq(agentVersions.id, id))
      .returning()
    return version
  }

  async updateTestResults(id: string, testResults: unknown): Promise<AgentVersion | undefined> {
    const [version] = await this.db
      .update(agentVersions)
      .set({ testResults })
      .where(eq(agentVersions.id, id))
      .returning()
    return version
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(agentVersions).where(eq(agentVersions.id, id))
  }
}


