// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Repository — Teams
// =============================================================================

import { eq } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { teams } from '../schema'

export type TeamRow = typeof teams.$inferSelect
export type NewTeam = typeof teams.$inferInsert

export class TeamRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewTeam): Promise<TeamRow> {
    const [team] = await this.db.insert(teams).values(data).returning()
    return team
  }

  async findById(id: string): Promise<TeamRow | undefined> {
    return this.db.query.teams.findFirst({
      where: eq(teams.id, id),
    })
  }

  async findByOrgId(orgId: string): Promise<TeamRow[]> {
    return this.db.query.teams.findMany({
      where: eq(teams.orgId, orgId),
    })
  }

  async update(
    id: string,
    data: Partial<Pick<NewTeam, 'name' | 'description' | 'memberIds'>>,
  ): Promise<TeamRow | undefined> {
    const [team] = await this.db
      .update(teams)
      .set(data)
      .where(eq(teams.id, id))
      .returning()
    return team
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(teams).where(eq(teams.id, id))
  }
}


