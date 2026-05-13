// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Repository — Publisher Payouts
// =============================================================================

import { eq, and, desc, gte, lte } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { publisherPayouts } from '../schema'

export type PublisherPayout = typeof publisherPayouts.$inferSelect
export type NewPublisherPayout = typeof publisherPayouts.$inferInsert

export class PublisherPayoutRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewPublisherPayout): Promise<PublisherPayout> {
    const [payout] = await this.db.insert(publisherPayouts).values(data).returning()
    return payout
  }

  async findById(id: string): Promise<PublisherPayout | undefined> {
    return this.db.query.publisherPayouts.findFirst({
      where: eq(publisherPayouts.id, id),
    })
  }

  async findByPublisher(publisherOrgId: string, limit = 12): Promise<PublisherPayout[]> {
    return this.db.query.publisherPayouts.findMany({
      where: eq(publisherPayouts.publisherOrgId, publisherOrgId),
      orderBy: [desc(publisherPayouts.periodEnd)],
      limit,
    })
  }

  async findByStatus(status: string): Promise<PublisherPayout[]> {
    return this.db.query.publisherPayouts.findMany({
      where: eq(publisherPayouts.status, status),
      orderBy: [desc(publisherPayouts.createdAt)],
    })
  }

  async update(
    id: string,
    data: Partial<Pick<PublisherPayout, 'status' | 'stripeTransferId' | 'grossRevenueCents' | 'platformFeeCents' | 'netPayoutCents'>>,
  ): Promise<PublisherPayout | undefined> {
    const [updated] = await this.db
      .update(publisherPayouts)
      .set(data)
      .where(eq(publisherPayouts.id, id))
      .returning()
    return updated
  }
}


