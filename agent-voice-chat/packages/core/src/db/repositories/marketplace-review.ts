// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Repository — Marketplace Reviews
// =============================================================================

import { eq, and, desc, avg, count, sql } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { marketplaceReviews } from '../schema'

export type MarketplaceReview = typeof marketplaceReviews.$inferSelect
export type NewMarketplaceReview = typeof marketplaceReviews.$inferInsert

export class MarketplaceReviewRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewMarketplaceReview): Promise<MarketplaceReview> {
    const [review] = await this.db.insert(marketplaceReviews).values(data).returning()
    return review
  }

  async findById(id: string): Promise<MarketplaceReview | undefined> {
    return this.db.query.marketplaceReviews.findFirst({
      where: eq(marketplaceReviews.id, id),
    })
  }

  async findByListing(listingId: string, limit = 50, offset = 0): Promise<MarketplaceReview[]> {
    return this.db.query.marketplaceReviews.findMany({
      where: eq(marketplaceReviews.listingId, listingId),
      orderBy: [desc(marketplaceReviews.createdAt)],
      limit,
      offset,
    })
  }

  async findByUserAndListing(userId: string, listingId: string): Promise<MarketplaceReview | undefined> {
    return this.db.query.marketplaceReviews.findFirst({
      where: and(
        eq(marketplaceReviews.userId, userId),
        eq(marketplaceReviews.listingId, listingId),
      ),
    })
  }

  /** Get aggregate rating stats for a listing. */
  async getListingStats(listingId: string): Promise<{ avg: number; count: number }> {
    const [result] = await this.db
      .select({
        avg: avg(marketplaceReviews.rating),
        count: count(),
      })
      .from(marketplaceReviews)
      .where(eq(marketplaceReviews.listingId, listingId))

    return {
      avg: Number(result?.avg ?? 0),
      count: Number(result?.count ?? 0),
    }
  }

  async update(
    id: string,
    data: Partial<Pick<MarketplaceReview, 'rating' | 'title' | 'body'>>,
  ): Promise<MarketplaceReview | undefined> {
    const [updated] = await this.db
      .update(marketplaceReviews)
      .set(data)
      .where(eq(marketplaceReviews.id, id))
      .returning()
    return updated
  }

  async incrementHelpful(id: string): Promise<void> {
    await this.db
      .update(marketplaceReviews)
      .set({ helpfulCount: sql`${marketplaceReviews.helpfulCount} + 1` })
      .where(eq(marketplaceReviews.id, id))
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(marketplaceReviews).where(eq(marketplaceReviews.id, id))
  }
}


