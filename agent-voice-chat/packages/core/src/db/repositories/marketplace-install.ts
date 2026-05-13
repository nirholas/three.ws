// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Repository — Marketplace Installs
// =============================================================================

import { eq, and, desc } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { marketplaceInstalls } from '../schema'

export type MarketplaceInstall = typeof marketplaceInstalls.$inferSelect
export type NewMarketplaceInstall = typeof marketplaceInstalls.$inferInsert

export class MarketplaceInstallRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewMarketplaceInstall): Promise<MarketplaceInstall> {
    const [install] = await this.db.insert(marketplaceInstalls).values(data).returning()
    return install
  }

  async findById(id: string): Promise<MarketplaceInstall | undefined> {
    return this.db.query.marketplaceInstalls.findFirst({
      where: eq(marketplaceInstalls.id, id),
    })
  }

  async findByOrgId(orgId: string): Promise<MarketplaceInstall[]> {
    return this.db.query.marketplaceInstalls.findMany({
      where: and(
        eq(marketplaceInstalls.orgId, orgId),
        eq(marketplaceInstalls.status, 'active'),
      ),
      orderBy: [desc(marketplaceInstalls.installedAt)],
    })
  }

  async findByListingAndOrg(listingId: string, orgId: string): Promise<MarketplaceInstall | undefined> {
    return this.db.query.marketplaceInstalls.findFirst({
      where: and(
        eq(marketplaceInstalls.listingId, listingId),
        eq(marketplaceInstalls.orgId, orgId),
        eq(marketplaceInstalls.status, 'active'),
      ),
    })
  }

  async findByListingId(listingId: string): Promise<MarketplaceInstall[]> {
    return this.db.query.marketplaceInstalls.findMany({
      where: eq(marketplaceInstalls.listingId, listingId),
      orderBy: [desc(marketplaceInstalls.installedAt)],
    })
  }

  async cancel(id: string): Promise<MarketplaceInstall | undefined> {
    const [updated] = await this.db
      .update(marketplaceInstalls)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(eq(marketplaceInstalls.id, id))
      .returning()
    return updated
  }

  async updateConfig(id: string, config: Record<string, unknown>): Promise<MarketplaceInstall | undefined> {
    const [updated] = await this.db
      .update(marketplaceInstalls)
      .set({ config })
      .where(eq(marketplaceInstalls.id, id))
      .returning()
    return updated
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(marketplaceInstalls).where(eq(marketplaceInstalls.id, id))
  }
}


