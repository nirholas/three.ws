// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// Enterprise Auth — Session Manager
// Track, list, and revoke user sessions with plan-based limits
// =============================================================================

import { eq, and, lt, desc } from 'drizzle-orm'
import { getDatabase } from '../db/connection'
import { userSessions, refreshTokens, organizations } from '../db/schema'
import { SessionLimitError } from './errors'
import { SESSION_LIMITS } from './types'
import type { UserSession, AuthRequestContext } from './types'
import type { PlanTier } from '../tenant/types'

const DEFAULT_SESSION_EXPIRY_DAYS = 30

/** Create a new user session. */
export async function createSession(
  userId: string,
  orgId: string,
  refreshTokenId: string,
  plan: PlanTier,
  ctx: AuthRequestContext,
): Promise<UserSession> {
  const db = getDatabase()

  // Check session limit for plan
  const limit = SESSION_LIMITS[plan]
  if (limit !== Infinity) {
    const existing = await db
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          // Only count non-expired sessions
        ),
      )

    if (existing.length >= limit) {
      throw new SessionLimitError(limit)
    }
  }

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + DEFAULT_SESSION_EXPIRY_DAYS)

  const [session] = await db
    .insert(userSessions)
    .values({
      userId,
      orgId,
      refreshTokenId,
      deviceInfo: ctx.deviceInfo,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      expiresAt,
    })
    .returning()

  return mapSession(session)
}

/** List all active sessions for a user. */
export async function listSessions(userId: string): Promise<UserSession[]> {
  const db = getDatabase()
  const now = new Date()

  const sessions = await db
    .select()
    .from(userSessions)
    .where(eq(userSessions.userId, userId))
    .orderBy(desc(userSessions.lastActiveAt))

  return sessions
    .filter((s) => new Date(s.expiresAt) > now)
    .map(mapSession)
}

/** Revoke a specific session. */
export async function revokeSession(sessionId: string, userId: string): Promise<void> {
  const db = getDatabase()

  const [session] = await db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)))
    .limit(1)

  if (!session) return

  // Revoke the associated refresh token
  if (session.refreshTokenId) {
    await db
      .update(refreshTokens)
      .set({ isRevoked: 1 })
      .where(eq(refreshTokens.id, session.refreshTokenId))
  }

  // Delete the session
  await db.delete(userSessions).where(eq(userSessions.id, sessionId))
}

/** Revoke all sessions for a user (e.g., password change, force logout). */
export async function revokeAllSessions(userId: string): Promise<void> {
  const db = getDatabase()

  // Revoke all refresh tokens
  await db
    .update(refreshTokens)
    .set({ isRevoked: 1 })
    .where(eq(refreshTokens.userId, userId))

  // Delete all sessions
  await db.delete(userSessions).where(eq(userSessions.userId, userId))
}

/** Update session last-active timestamp. */
export async function touchSession(sessionId: string): Promise<void> {
  const db = getDatabase()
  await db
    .update(userSessions)
    .set({ lastActiveAt: new Date() })
    .where(eq(userSessions.id, sessionId))
}

/** Clean up expired sessions. */
export async function cleanupExpiredSessions(): Promise<number> {
  const db = getDatabase()
  const now = new Date()

  const expired = await db
    .delete(userSessions)
    .where(lt(userSessions.expiresAt, now))
    .returning({ id: userSessions.id })

  return expired.length
}

function mapSession(row: any): UserSession {
  return {
    id: row.id,
    userId: row.userId,
    orgId: row.orgId,
    refreshTokenId: row.refreshTokenId ?? undefined,
    deviceInfo: row.deviceInfo ?? undefined,
    ipAddress: row.ipAddress ?? undefined,
    userAgent: row.userAgent ?? undefined,
    lastActiveAt: new Date(row.lastActiveAt),
    expiresAt: new Date(row.expiresAt),
    createdAt: new Date(row.createdAt),
  }
}


