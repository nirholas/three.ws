// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Repository — Marketplace Listings
// =============================================================================

import { eq, and, desc, asc, ilike, sql, or, type SQL, type SQLWrapper } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { marketplaceListings } from '../schema'

export type MarketplaceListing = typeof marketplaceListings.$inferSelect
export type NewMarketplaceListing = typeof marketplaceListings.$inferInsert

export interface ListingSearchOptions {
  query?: string
  type?: string
  category?: string
  pricingModel?: string
  status?: string
  featured?: boolean
  publisherOrgId?: string
  sort?: 'popular' | 'newest' | 'rating' | 'name'
  limit?: number
  offset?: number
}

export class MarketplaceListingRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewMarketplaceListing): Promise<MarketplaceListing> {
    const [listing] = await this.db.insert(marketplaceListings).values(data).returning()
    return listing
  }

  async findById(id: string): Promise<MarketplaceListing | undefined> {
    return this.db.query.marketplaceListings.findFirst({
      where: eq(marketplaceListings.id, id),
    })
  }

  async findBySlug(slug: string): Promise<MarketplaceListing | undefined> {
    return this.db.query.marketplaceListings.findFirst({
      where: eq(marketplaceListings.slug, slug),
    })
  }

  async search(options: ListingSearchOptions = {}): Promise<{ listings: MarketplaceListing[]; total: number }> {
    const conditions: SQLWrapper[] = []

    // Default to published unless explicitly querying another status
    conditions.push(eq(marketplaceListings.status, options.status ?? 'published'))

    if (options.type) {
      conditions.push(eq(marketplaceListings.type, options.type))
    }
    if (options.category) {
      conditions.push(eq(marketplaceListings.category, options.category))
    }
    if (options.pricingModel) {
      conditions.push(eq(marketplaceListings.pricingModel, options.pricingModel))
    }
    if (options.featured) {
      conditions.push(eq(marketplaceListings.featured, 1))
    }
    if (options.publisherOrgId) {
      conditions.push(eq(marketplaceListings.publisherOrgId, options.publisherOrgId))
    }
    if (options.query) {
      const pattern = `%${options.query}%`
      conditions.push(
        or(
          ilike(marketplaceListings.name, pattern),
          ilike(marketplaceListings.description, pattern),
        )!,
      )
    }

    const where = (conditions.length > 1 ? and(...conditions) : conditions[0]) as SQL<unknown> | undefined

    // Sort
    let orderBy
    switch (options.sort) {
      case 'popular':
        orderBy = [desc(marketplaceListings.installCount)]
        break
      case 'rating':
        orderBy = [desc(marketplaceListings.ratingAvg)]
        break
      case 'name':
        orderBy = [asc(marketplaceListings.name)]
        break
      case 'newest':
      default:
        orderBy = [desc(marketplaceListings.createdAt)]
    }

    const limit = Math.min(options.limit ?? 20, 100)
    const offset = options.offset ?? 0

    const [listings, countResult] = await Promise.all([
      this.db.query.marketplaceListings.findMany({
        where,
        orderBy,
        limit,
        offset,
      }),
      this.db.select({ count: sql<number>`count(*)` })
        .from(marketplaceListings)
        .where(where),
    ])

    return { listings, total: Number(countResult[0]?.count ?? 0) }
  }

  async findFeatured(limit = 10): Promise<MarketplaceListing[]> {
    return this.db.query.marketplaceListings.findMany({
      where: and(
        eq(marketplaceListings.status, 'published'),
        eq(marketplaceListings.featured, 1),
      ),
      orderBy: [desc(marketplaceListings.installCount)],
      limit,
    })
  }

  async findByPublisher(publisherOrgId: string): Promise<MarketplaceListing[]> {
    return this.db.query.marketplaceListings.findMany({
      where: eq(marketplaceListings.publisherOrgId, publisherOrgId),
      orderBy: [desc(marketplaceListings.createdAt)],
    })
  }

  async getCategories(): Promise<{ category: string; count: number }[]> {
    const result = await this.db
      .select({
        category: marketplaceListings.category,
        count: sql<number>`count(*)`,
      })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.status, 'published'))
      .groupBy(marketplaceListings.category)
      .orderBy(desc(sql`count(*)`))
    return result.map((r) => ({ category: r.category, count: Number(r.count) }))
  }

  async findPendingReview(): Promise<MarketplaceListing[]> {
    return this.db.query.marketplaceListings.findMany({
      where: eq(marketplaceListings.status, 'in_review'),
      orderBy: [asc(marketplaceListings.createdAt)],
    })
  }

  async update(
    id: string,
    data: Partial<Omit<MarketplaceListing, 'id' | 'createdAt'>>,
  ): Promise<MarketplaceListing | undefined> {
    const [updated] = await this.db
      .update(marketplaceListings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(marketplaceListings.id, id))
      .returning()
    return updated
  }

  async incrementInstallCount(id: string): Promise<void> {
    await this.db
      .update(marketplaceListings)
      .set({
        installCount: sql`${marketplaceListings.installCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(marketplaceListings.id, id))
  }

  async decrementInstallCount(id: string): Promise<void> {
    await this.db
      .update(marketplaceListings)
      .set({
        installCount: sql`GREATEST(${marketplaceListings.installCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(marketplaceListings.id, id))
  }

  async updateRating(id: string, avg: number, count: number): Promise<void> {
    await this.db
      .update(marketplaceListings)
      .set({ ratingAvg: avg, ratingCount: count, updatedAt: new Date() })
      .where(eq(marketplaceListings.id, id))
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(marketplaceListings).where(eq(marketplaceListings.id, id))
  }
}


