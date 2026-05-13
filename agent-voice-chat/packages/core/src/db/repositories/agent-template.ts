// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// =============================================================================
// Repository — Agent Templates (Reseller Syndication)
// =============================================================================

import { eq } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { agentTemplates } from '../schema'

export type AgentTemplateRow = typeof agentTemplates.$inferSelect
export type NewAgentTemplate = typeof agentTemplates.$inferInsert

export class AgentTemplateRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewAgentTemplate): Promise<AgentTemplateRow> {
    const [template] = await this.db.insert(agentTemplates).values(data).returning()
    return template
  }

  async findById(id: string): Promise<AgentTemplateRow | undefined> {
    return this.db.query.agentTemplates.findFirst({
      where: eq(agentTemplates.id, id),
    })
  }

  async findByResellerId(resellerId: string): Promise<AgentTemplateRow[]> {
    return this.db.query.agentTemplates.findMany({
      where: eq(agentTemplates.resellerId, resellerId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    })
  }

  async update(id: string, data: Partial<NewAgentTemplate>): Promise<AgentTemplateRow | undefined> {
    const [updated] = await this.db
      .update(agentTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(agentTemplates.id, id))
      .returning()
    return updated
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(agentTemplates).where(eq(agentTemplates.id, id))
  }
}


