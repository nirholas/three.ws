// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§89]

// =============================================================================
// Repository — Invitations
// =============================================================================

import { eq, and, desc } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { invitations } from '../schema'

export type InvitationRow = typeof invitations.$inferSelect
export type NewInvitation = typeof invitations.$inferInsert

export class InvitationRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewInvitation): Promise<InvitationRow> {
    const [invitation] = await this.db.insert(invitations).values(data).returning()
    return invitation
  }

  async findById(id: string): Promise<InvitationRow | undefined> {
    return this.db.query.invitations.findFirst({
      where: eq(invitations.id, id),
    })
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationRow | undefined> {
    return this.db.query.invitations.findFirst({
      where: eq(invitations.tokenHash, tokenHash),
    })
  }

  async findByOrgId(orgId: string): Promise<InvitationRow[]> {
    return this.db.query.invitations.findMany({
      where: eq(invitations.orgId, orgId),
      orderBy: [desc(invitations.createdAt)],
    })
  }

  async findPendingByEmail(email: string, orgId: string): Promise<InvitationRow | undefined> {
    return this.db.query.invitations.findFirst({
      where: and(
        eq(invitations.email, email),
        eq(invitations.orgId, orgId),
        eq(invitations.status, 'pending'),
      ),
    })
  }

  async updateStatus(id: string, status: string): Promise<InvitationRow | undefined> {
    const [invitation] = await this.db
      .update(invitations)
      .set({ status })
      .where(eq(invitations.id, id))
      .returning()
    return invitation
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(invitations).where(eq(invitations.id, id))
  }
}


