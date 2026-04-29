// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Enterprise Auth — JWT Token Service
// Access/refresh token generation, rotation, and replay detection
// =============================================================================

import jwt from 'jsonwebtoken'
import { eq, and } from 'drizzle-orm'
import { getDatabase } from '../db/connection'
import { refreshTokens, users, userSessions } from '../db/schema'
import { sha256, generateSecureToken, generateUUID } from './crypto'
import { TokenError } from './errors'
import type { AccessTokenPayload, TokenPair, RefreshTokenRecord, AuthRequestContext } from './types'
import type { OrgRole, PlanTier } from '../tenant/types'

const ACCESS_TOKEN_EXPIRY = '15m'
const REFRESH_TOKEN_EXPIRY_DAYS = 30

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is required. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"',
    )
  }
  return secret
}

/** Sign an access token (short-lived, 15 minutes). */
export function signAccessToken(payload: {
  userId: string
  orgId: string
  role: OrgRole
  plan: PlanTier
  scopes: string[]
}): string {
  const tokenPayload: Omit<AccessTokenPayload, 'iat' | 'exp'> = {
    sub: payload.userId,
    org: payload.orgId,
    role: payload.role,
    plan: payload.plan,
    scopes: payload.scopes,
  }
  return jwt.sign(tokenPayload, getJwtSecret(), {
    expiresIn: ACCESS_TOKEN_EXPIRY,
    algorithm: 'HS256',
  })
}

/** Verify and decode an access token. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    }) as AccessTokenPayload
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      throw new TokenError('expired')
    }
    throw new TokenError('invalid')
  }
}

/** Create a new token pair (access + refresh). */
export async function createTokenPair(
  userId: string,
  orgId: string,
  role: OrgRole,
  plan: PlanTier,
  scopes: string[],
  ctx: AuthRequestContext,
  familyId?: string,
): Promise<TokenPair & { refreshTokenId: string; familyId: string }> {
  const db = getDatabase()

  const accessToken = signAccessToken({ userId, orgId, role, plan, scopes })

  const rawRefreshToken = generateSecureToken(48)
  const tokenHash = sha256(rawRefreshToken)
  const family = familyId ?? generateUUID()

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS)

  const [record] = await db
    .insert(refreshTokens)
    .values({
      userId,
      tokenHash,
      familyId: family,
      deviceInfo: ctx.deviceInfo,
      ipAddress: ctx.ipAddress,
      expiresAt,
    })
    .returning({ id: refreshTokens.id })

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    expiresIn: 900, // 15 minutes in seconds
    refreshTokenId: record.id,
    familyId: family,
  }
}

/** Rotate a refresh token: validate the old one, issue a new pair. */
export async function rotateRefreshToken(
  rawRefreshToken: string,
  ctx: AuthRequestContext,
): Promise<TokenPair & { refreshTokenId: string }> {
  const db = getDatabase()
  const tokenHash = sha256(rawRefreshToken)

  // Find the refresh token
  const [existing] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1)

  if (!existing) {
    throw new TokenError('invalid')
  }

  // Check if revoked — possible replay attack
  if (existing.isRevoked) {
    // Revoke ALL tokens in this family (security: token reuse detected)
    await db
      .update(refreshTokens)
      .set({ isRevoked: 1 })
      .where(eq(refreshTokens.familyId, existing.familyId))

    // Also invalidate all sessions for this user
    await db
      .delete(userSessions)
      .where(eq(userSessions.userId, existing.userId))

    throw new TokenError('replay')
  }

  // Check expiration
  if (new Date(existing.expiresAt) < new Date()) {
    throw new TokenError('expired')
  }

  // Revoke the old token
  await db
    .update(refreshTokens)
    .set({ isRevoked: 1 })
    .where(eq(refreshTokens.id, existing.id))

  // Get user info for new access token
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, existing.userId))
    .limit(1)

  if (!user) {
    throw new TokenError('invalid')
  }

  // Issue new token pair in the same family
  const result = await createTokenPair(
    user.id,
    user.orgId!,
    user.role as OrgRole,
    'free', // Will be resolved by middleware from org plan
    [], // Will be resolved by middleware
    ctx,
    existing.familyId,
  )

  // Update the session's refresh token reference
  await db
    .update(userSessions)
    .set({
      refreshTokenId: result.refreshTokenId,
      lastActiveAt: new Date(),
    })
    .where(eq(userSessions.refreshTokenId, existing.id))

  return result
}

/** Revoke a specific refresh token. */
export async function revokeRefreshToken(tokenId: string): Promise<void> {
  const db = getDatabase()
  await db
    .update(refreshTokens)
    .set({ isRevoked: 1 })
    .where(eq(refreshTokens.id, tokenId))
}

/** Revoke all refresh tokens for a user (e.g., password change). */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  const db = getDatabase()
  await db
    .update(refreshTokens)
    .set({ isRevoked: 1 })
    .where(eq(refreshTokens.userId, userId))
}


