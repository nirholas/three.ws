// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Repository — Organization Members
// =============================================================================

import { eq, and } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { orgMembers, users } from '../schema'

export type OrgMemberRow = typeof orgMembers.$inferSelect
export type NewOrgMember = typeof orgMembers.$inferInsert

export class MemberRepository {
  private get db() {
    return getDatabase()
  }

  async add(data: NewOrgMember): Promise<OrgMemberRow> {
    const [member] = await this.db.insert(orgMembers).values(data).returning()
    return member
  }

  async findByOrgAndUser(orgId: string, userId: string): Promise<OrgMemberRow | undefined> {
    const results = await this.db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
      .limit(1)
    return results[0]
  }

  async findByOrgId(orgId: string): Promise<(OrgMemberRow & { email: string; name: string | null })[]> {
    return this.db
      .select({
        orgId: orgMembers.orgId,
        userId: orgMembers.userId,
        role: orgMembers.role,
        customRoleId: orgMembers.customRoleId,
        invitedBy: orgMembers.invitedBy,
        joinedAt: orgMembers.joinedAt,
        email: users.email,
        name: users.name,
      })
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(eq(orgMembers.orgId, orgId))
  }

  async findByUserId(userId: string): Promise<OrgMemberRow[]> {
    return this.db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.userId, userId))
  }

  async updateRole(
    orgId: string,
    userId: string,
    role: string,
    customRoleId?: string | null,
  ): Promise<OrgMemberRow | undefined> {
    const [updated] = await this.db
      .update(orgMembers)
      .set({ role, customRoleId: customRoleId ?? null })
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
      .returning()
    return updated
  }

  async remove(orgId: string, userId: string): Promise<void> {
    await this.db
      .delete(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
  }

  async countByOrg(orgId: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.orgId, orgId))
    return rows.length
  }
}


