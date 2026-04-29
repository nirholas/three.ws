// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Repository — Sub-Organizations (Reseller Child Tenants)
// =============================================================================

import { eq, and, sql } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { subOrganizations } from '../schema'

export type SubOrganizationRow = typeof subOrganizations.$inferSelect
export type NewSubOrganization = typeof subOrganizations.$inferInsert

export class SubOrganizationRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewSubOrganization): Promise<SubOrganizationRow> {
    const [subOrg] = await this.db.insert(subOrganizations).values(data).returning()
    return subOrg
  }

  async findById(id: string): Promise<SubOrganizationRow | undefined> {
    return this.db.query.subOrganizations.findFirst({
      where: eq(subOrganizations.id, id),
    })
  }

  async findByOrgId(orgId: string): Promise<SubOrganizationRow | undefined> {
    return this.db.query.subOrganizations.findFirst({
      where: eq(subOrganizations.orgId, orgId),
    })
  }

  async findBySlug(slug: string): Promise<SubOrganizationRow | undefined> {
    return this.db.query.subOrganizations.findFirst({
      where: eq(subOrganizations.slug, slug),
    })
  }

  async findByResellerId(resellerId: string): Promise<SubOrganizationRow[]> {
    return this.db.query.subOrganizations.findMany({
      where: eq(subOrganizations.resellerId, resellerId),
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    })
  }

  async update(id: string, data: Partial<NewSubOrganization>): Promise<SubOrganizationRow | undefined> {
    const [updated] = await this.db
      .update(subOrganizations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(subOrganizations.id, id))
      .returning()
    return updated
  }

  async updateStatus(id: string, status: string): Promise<SubOrganizationRow | undefined> {
    const [updated] = await this.db
      .update(subOrganizations)
      .set({ status, updatedAt: new Date() })
      .where(eq(subOrganizations.id, id))
      .returning()
    return updated
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(subOrganizations).where(eq(subOrganizations.id, id))
  }

  async countByReseller(resellerId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(subOrganizations)
      .where(eq(subOrganizations.resellerId, resellerId))
    return rows[0]?.count ?? 0
  }

  async countByResellerAndStatus(resellerId: string, status: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(subOrganizations)
      .where(and(eq(subOrganizations.resellerId, resellerId), eq(subOrganizations.status, status)))
    return rows[0]?.count ?? 0
  }
}


