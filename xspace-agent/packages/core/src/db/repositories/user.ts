// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// =============================================================================
// Repository — Users
// =============================================================================

import { eq, and } from 'drizzle-orm'
import { getDatabase } from '../connection'
import { users } from '../schema'

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

export class UserRepository {
  private get db() {
    return getDatabase()
  }

  async create(data: NewUser): Promise<User> {
    const [user] = await this.db.insert(users).values(data).returning()
    return user
  }

  async findById(id: string): Promise<User | undefined> {
    return this.db.query.users.findFirst({
      where: eq(users.id, id),
    })
  }

  async findByEmail(email: string): Promise<User | undefined> {
    return this.db.query.users.findFirst({
      where: eq(users.email, email),
    })
  }

  async findByOrgId(orgId: string): Promise<User[]> {
    return this.db.query.users.findMany({
      where: eq(users.orgId, orgId),
    })
  }

  async findBySSOSubject(provider: string, subject: string): Promise<User | undefined> {
    return this.db.query.users.findFirst({
      where: and(eq(users.ssoProvider, provider), eq(users.ssoSubject, subject)),
    })
  }

  async update(id: string, data: Partial<NewUser>): Promise<User | undefined> {
    const [user] = await this.db
      .update(users)
      .set(data)
      .where(eq(users.id, id))
      .returning()
    return user
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, id))
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(users).where(eq(users.id, id))
  }
}


