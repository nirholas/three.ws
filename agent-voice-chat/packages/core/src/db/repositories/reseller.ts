// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Repository — Resellers (White-Label Partners)
// =============================================================================

import { eq } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { resellers } from '../schema'

export type ResellerRow = typeof resellers.$inferSelect
export type NewReseller = typeof resellers.$inferInsert

export class ResellerRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewReseller): Promise<ResellerRow> {
    const [reseller] = await this.db.insert(resellers).values(data).returning()
    return reseller
  }

  async findById(id: string): Promise<ResellerRow | undefined> {
    return this.db.query.resellers.findFirst({
      where: eq(resellers.id, id),
    })
  }

  async findByOrgId(orgId: string): Promise<ResellerRow | undefined> {
    return this.db.query.resellers.findFirst({
      where: eq(resellers.orgId, orgId),
    })
  }

  async update(id: string, data: Partial<NewReseller>): Promise<ResellerRow | undefined> {
    const [updated] = await this.db
      .update(resellers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(resellers.id, id))
      .returning()
    return updated
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(resellers).where(eq(resellers.id, id))
  }

  async list(): Promise<ResellerRow[]> {
    return this.db.query.resellers.findMany({
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    })
  }

  async listByStatus(status: string): Promise<ResellerRow[]> {
    return this.db.query.resellers.findMany({
      where: eq(resellers.status, status),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    })
  }
}


