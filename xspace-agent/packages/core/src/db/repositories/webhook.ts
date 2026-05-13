// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Repository — Webhooks
// =============================================================================

import { eq, and, desc } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { webhooks } from '../schema'

export type Webhook = typeof webhooks.$inferSelect
export type NewWebhook = typeof webhooks.$inferInsert

export class WebhookRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewWebhook): Promise<Webhook> {
    const [webhook] = await this.db.insert(webhooks).values(data).returning()
    return webhook
  }

  async findById(id: string): Promise<Webhook | undefined> {
    return this.db.query.webhooks.findFirst({
      where: eq(webhooks.id, id),
    })
  }

  async findByOrgId(orgId: string): Promise<Webhook[]> {
    return this.db.query.webhooks.findMany({
      where: eq(webhooks.orgId, orgId),
      orderBy: [desc(webhooks.createdAt)],
    })
  }

  /** Find all active webhooks for an org that subscribe to a given event type. */
  async findActiveForEvent(orgId: string, eventType: string): Promise<Webhook[]> {
    const orgWebhooks = await this.db.query.webhooks.findMany({
      where: and(
        eq(webhooks.orgId, orgId),
        eq(webhooks.active, 'true'),
      ),
    })
    // Filter by event subscription (array contains check)
    return orgWebhooks.filter((w) => w.events.includes(eventType) || w.events.includes('*'))
  }

  async update(id: string, data: Partial<Pick<Webhook, 'url' | 'events' | 'active' | 'description' | 'headers' | 'failureCount'>>): Promise<Webhook | undefined> {
    const [updated] = await this.db
      .update(webhooks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(webhooks.id, id))
      .returning()
    return updated
  }

  async updateSecret(id: string, secret: string): Promise<Webhook | undefined> {
    const [updated] = await this.db
      .update(webhooks)
      .set({ secret, updatedAt: new Date() })
      .where(eq(webhooks.id, id))
      .returning()
    return updated
  }

  async incrementFailureCount(id: string): Promise<number> {
    const webhook = await this.findById(id)
    if (!webhook) return 0
    const newCount = (webhook.failureCount ?? 0) + 1
    await this.db
      .update(webhooks)
      .set({ failureCount: newCount, updatedAt: new Date() })
      .where(eq(webhooks.id, id))
    return newCount
  }

  async resetFailureCount(id: string): Promise<void> {
    await this.db
      .update(webhooks)
      .set({ failureCount: 0, updatedAt: new Date() })
      .where(eq(webhooks.id, id))
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(webhooks).where(eq(webhooks.id, id))
  }
}


