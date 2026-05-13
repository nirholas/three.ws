// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Repository — Agents
// =============================================================================

import { eq } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { agents } from '../schema'

export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert

export class AgentRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewAgent): Promise<Agent> {
    const [agent] = await this.db.insert(agents).values(data).returning()
    return agent
  }

  async findById(id: string): Promise<Agent | undefined> {
    return this.db.query.agents.findFirst({
      where: eq(agents.id, id),
    })
  }

  async findByOrgId(orgId: string): Promise<Agent[]> {
    return this.db.query.agents.findMany({
      where: eq(agents.orgId, orgId),
      orderBy: (a, { desc }) => [desc(a.createdAt)],
    })
  }

  async update(id: string, data: Partial<NewAgent>): Promise<Agent | undefined> {
    const [agent] = await this.db
      .update(agents)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning()
    return agent
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db
      .update(agents)
      .set({ status, updatedAt: new Date() })
      .where(eq(agents.id, id))
  }

  async incrementVersion(id: string): Promise<Agent | undefined> {
    const current = await this.findById(id)
    if (!current) return undefined
    const [agent] = await this.db
      .update(agents)
      .set({ version: (current.version ?? 0) + 1, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning()
    return agent
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(agents).where(eq(agents.id, id))
  }
}


