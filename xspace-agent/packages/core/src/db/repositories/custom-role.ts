// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// =============================================================================
// Repository — Custom Roles (Enterprise)
// =============================================================================

import { eq, and } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { customRoles } from '../schema'

export type CustomRoleRow = typeof customRoles.$inferSelect
export type NewCustomRole = typeof customRoles.$inferInsert

export class CustomRoleRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewCustomRole): Promise<CustomRoleRow> {
    const [role] = await this.db.insert(customRoles).values(data).returning()
    return role
  }

  async findById(id: string): Promise<CustomRoleRow | undefined> {
    return this.db.query.customRoles.findFirst({
      where: eq(customRoles.id, id),
    })
  }

  async findByOrgId(orgId: string): Promise<CustomRoleRow[]> {
    return this.db.query.customRoles.findMany({
      where: eq(customRoles.orgId, orgId),
    })
  }

  async findByName(orgId: string, name: string): Promise<CustomRoleRow | undefined> {
    return this.db.query.customRoles.findFirst({
      where: and(eq(customRoles.orgId, orgId), eq(customRoles.name, name)),
    })
  }

  async update(
    id: string,
    data: Partial<Pick<NewCustomRole, 'name' | 'description' | 'permissions'>>,
  ): Promise<CustomRoleRow | undefined> {
    const [role] = await this.db
      .update(customRoles)
      .set(data)
      .where(eq(customRoles.id, id))
      .returning()
    return role
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(customRoles).where(eq(customRoles.id, id))
  }
}


