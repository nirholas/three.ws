// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Repository — Conversations
// =============================================================================

import { eq, desc } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { conversations } from '../schema'

export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert

export class ConversationRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewConversation): Promise<Conversation> {
    const [conv] = await this.db.insert(conversations).values(data).returning()
    return conv
  }

  async findById(id: string): Promise<Conversation | undefined> {
    return this.db.query.conversations.findFirst({
      where: eq(conversations.id, id),
    })
  }

  async findBySessionId(sessionId: string): Promise<Conversation[]> {
    return this.db.query.conversations.findMany({
      where: eq(conversations.sessionId, sessionId),
      orderBy: [desc(conversations.createdAt)],
    })
  }

  async findByOrgId(orgId: string, limit = 50): Promise<Conversation[]> {
    return this.db.query.conversations.findMany({
      where: eq(conversations.orgId, orgId),
      orderBy: [desc(conversations.createdAt)],
      limit,
    })
  }

  async update(id: string, data: Partial<NewConversation>): Promise<Conversation | undefined> {
    const [conv] = await this.db
      .update(conversations)
      .set(data)
      .where(eq(conversations.id, id))
      .returning()
    return conv
  }

  async appendMessages(id: string, newMessages: unknown[]): Promise<void> {
    const conv = await this.findById(id)
    if (!conv) return
    const existing = Array.isArray(conv.messages) ? conv.messages : []
    await this.db
      .update(conversations)
      .set({ messages: [...existing, ...newMessages] })
      .where(eq(conversations.id, id))
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(conversations).where(eq(conversations.id, id))
  }
}


