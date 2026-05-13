// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Repository — Custom Domains
// =============================================================================

import { eq, and } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { customDomains } from '../schema'

export type CustomDomainRow = typeof customDomains.$inferSelect
export type NewCustomDomain = typeof customDomains.$inferInsert

export class CustomDomainRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewCustomDomain): Promise<CustomDomainRow> {
    const [domain] = await this.db.insert(customDomains).values(data).returning()
    return domain
  }

  async findById(id: string): Promise<CustomDomainRow | undefined> {
    return this.db.query.customDomains.findFirst({
      where: eq(customDomains.id, id),
    })
  }

  async findByDomain(domain: string): Promise<CustomDomainRow | undefined> {
    return this.db.query.customDomains.findFirst({
      where: eq(customDomains.domain, domain),
    })
  }

  async findByResellerId(resellerId: string): Promise<CustomDomainRow[]> {
    return this.db.query.customDomains.findMany({
      where: eq(customDomains.resellerId, resellerId),
      orderBy: (d, { desc }) => [desc(d.createdAt)],
    })
  }

  async findByOrgId(orgId: string): Promise<CustomDomainRow[]> {
    return this.db.query.customDomains.findMany({
      where: eq(customDomains.orgId, orgId),
    })
  }

  async update(id: string, data: Partial<NewCustomDomain>): Promise<CustomDomainRow | undefined> {
    const [updated] = await this.db
      .update(customDomains)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(customDomains.id, id))
      .returning()
    return updated
  }

  async updateStatus(id: string, status: string, verifiedAt?: Date): Promise<CustomDomainRow | undefined> {
    const data: Record<string, unknown> = { status, updatedAt: new Date() }
    if (verifiedAt) data.verifiedAt = verifiedAt
    const [updated] = await this.db
      .update(customDomains)
      .set(data)
      .where(eq(customDomains.id, id))
      .returning()
    return updated
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(customDomains).where(eq(customDomains.id, id))
  }
}


