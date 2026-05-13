// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Repository — Webhook Deliveries
// =============================================================================

import { eq, and, lte, desc } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { webhookDeliveries } from '../schema'

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert

export class WebhookDeliveryRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewWebhookDelivery): Promise<WebhookDelivery> {
    const [delivery] = await this.db.insert(webhookDeliveries).values(data).returning()
    return delivery
  }

  async findById(id: string): Promise<WebhookDelivery | undefined> {
    return this.db.query.webhookDeliveries.findFirst({
      where: eq(webhookDeliveries.id, id),
    })
  }

  async findByWebhookId(webhookId: string, options?: { limit?: number }): Promise<WebhookDelivery[]> {
    return this.db.query.webhookDeliveries.findMany({
      where: eq(webhookDeliveries.webhookId, webhookId),
      orderBy: [desc(webhookDeliveries.createdAt)],
      limit: options?.limit ?? 50,
    })
  }

  /** Find deliveries that are due for retry (status = 'failed', nextRetryAt <= now). */
  async findRetryable(limit = 100): Promise<WebhookDelivery[]> {
    const now = new Date()
    return this.db.query.webhookDeliveries.findMany({
      where: and(
        eq(webhookDeliveries.status, 'failed'),
        lte(webhookDeliveries.nextRetryAt, now),
      ),
      orderBy: [webhookDeliveries.nextRetryAt],
      limit,
    })
  }

  async updateStatus(
    id: string,
    data: {
      status: string
      attempts?: number
      lastAttemptAt?: Date
      nextRetryAt?: Date | null
      responseStatus?: number
      responseBody?: string
      durationMs?: number
    },
  ): Promise<WebhookDelivery | undefined> {
    const [updated] = await this.db
      .update(webhookDeliveries)
      .set({
        status: data.status,
        ...(data.attempts !== undefined && { attempts: data.attempts }),
        ...(data.lastAttemptAt && { lastAttemptAt: data.lastAttemptAt }),
        ...(data.nextRetryAt !== undefined && { nextRetryAt: data.nextRetryAt }),
        ...(data.responseStatus !== undefined && { responseStatus: data.responseStatus }),
        ...(data.responseBody !== undefined && { responseBody: data.responseBody }),
        ...(data.durationMs !== undefined && { durationMs: data.durationMs }),
      })
      .where(eq(webhookDeliveries.id, id))
      .returning()
    return updated
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(webhookDeliveries).where(eq(webhookDeliveries.id, id))
  }
}


