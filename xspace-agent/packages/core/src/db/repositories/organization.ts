// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// =============================================================================
// Repository — Organizations
// =============================================================================

import { eq } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { organizations } from '../schema'

export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert

export class OrganizationRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewOrganization): Promise<Organization> {
    const [org] = await this.db.insert(organizations).values(data).returning()
    return org
  }

  async findById(id: string): Promise<Organization | undefined> {
    return this.db.query.organizations.findFirst({
      where: eq(organizations.id, id),
    })
  }

  async findBySlug(slug: string): Promise<Organization | undefined> {
    return this.db.query.organizations.findFirst({
      where: eq(organizations.slug, slug),
    })
  }

  async findByStripeCustomerId(customerId: string): Promise<Organization | undefined> {
    return this.db.query.organizations.findFirst({
      where: eq(organizations.stripeCustomerId, customerId),
    })
  }

  async update(id: string, data: Partial<NewOrganization>): Promise<Organization | undefined> {
    const [org] = await this.db
      .update(organizations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning()
    return org
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(organizations).where(eq(organizations.id, id))
  }

  async list(): Promise<Organization[]> {
    return this.db.query.organizations.findMany({
      orderBy: (orgs, { desc }) => [desc(orgs.createdAt)],
    })
  }
}


