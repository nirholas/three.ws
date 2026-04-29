// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Enterprise Auth — Main Auth Service
// Orchestrates registration, login, logout, refresh, password reset
// =============================================================================

import { eq } from 'drizzle-orm'
import { getDatabase } from '../db/connection'
import { users, organizations } from '../db/schema'
import { hashPassword, verifyPassword, requireStrongPassword, getLockoutDuration, isAccountLocked } from './password'
import { createTokenPair, rotateRefreshToken, revokeAllUserTokens } from './tokens'
import { createSession, revokeSession, revokeAllSessions, listSessions } from './sessions'
import { isMFAEnabled, verifyMFACode, setupMFA, verifyMFASetup, disableMFA } from './mfa'
import { isSSOEnforced } from './saml'
import {
  InvalidCredentialsError,
  AccountLockedError,
  EmailAlreadyExistsError,
  MFARequiredError,
  SSOEnforcedError,
  TokenError,
} from './errors'
import { generateSecureToken, sha256 } from './crypto'
import { checkRateLimit } from '../db/redis'
import type {
  RegisterInput,
  LoginInput,
  AuthResult,
  AuthRequestContext,
  TokenPair,
  UserSession,
  MFASetupResult,
} from './types'
import type { OrgRole, PlanTier } from '../tenant/types'

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register a new user with email/password and create their organization. */
export async function register(input: RegisterInput, ctx: AuthRequestContext): Promise<AuthResult> {
  const db = getDatabase()

  // Validate password strength
  requireStrongPassword(input.password)

  // Check if email already exists
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email.toLowerCase()))
    .limit(1)

  if (existing) {
    throw new EmailAlreadyExistsError(input.email)
  }

  // Create organization
  const slug = input.orgSlug ?? input.orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  const [org] = await db
    .insert(organizations)
    .values({
      name: input.orgName,
      slug,
      plan: 'free',
    })
    .returning()

  // Create user
  const passwordHash = await hashPassword(input.password)

  const [user] = await db
    .insert(users)
    .values({
      orgId: org.id,
      email: input.email.toLowerCase(),
      name: input.name,
      role: 'owner',
      passwordHash,
    })
    .returning()

  // Create tokens and session
  const plan: PlanTier = 'free'
  const scopes = ['*']
  const tokens = await createTokenPair(user.id, org.id, 'owner', plan, scopes, ctx)
  const session = await createSession(user.id, org.id, tokens.refreshTokenId, plan, ctx)

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: 'owner',
      orgId: org.id,
      mfaEnabled: false,
    },
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    },
    session,
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/** Authenticate a user with email/password. */
export async function login(input: LoginInput, ctx: AuthRequestContext): Promise<AuthResult> {
  const db = getDatabase()

  // Rate limiting
  const rateKey = `auth:login:${ctx.ipAddress}`
  const { allowed } = await checkRateLimit(rateKey, 10, 60)
  if (!allowed) {
    throw new AccountLockedError(new Date(Date.now() + 60_000))
  }

  // Find user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email.toLowerCase()))
    .limit(1)

  if (!user) {
    throw new InvalidCredentialsError()
  }

  // Check account lockout
  const failedAttempts = (user as any).failedLoginAttempts ?? 0
  const lockedUntil = (user as any).lockedUntil ?? null

  if (isAccountLocked(failedAttempts, lockedUntil ? new Date(lockedUntil) : null)) {
    throw new AccountLockedError(lockedUntil ? new Date(lockedUntil) : null)
  }

  // Check if SSO is enforced for this org
  if (user.orgId) {
    const ssoEnforced = await isSSOEnforced(user.orgId)
    if (ssoEnforced && !user.ssoProvider) {
      const [org] = await db
        .select({ slug: organizations.slug })
        .from(organizations)
        .where(eq(organizations.id, user.orgId))
        .limit(1)

      throw new SSOEnforcedError(org?.slug ?? user.orgId)
    }
  }

  // Verify password
  if (!user.passwordHash) {
    throw new InvalidCredentialsError('No password set for this account. Use SSO or OAuth to log in.')
  }

  const valid = await verifyPassword(input.password, user.passwordHash)
  if (!valid) {
    // Increment failed attempts
    const newAttempts = failedAttempts + 1
    const lockout = getLockoutDuration(newAttempts)

    await db
      .update(users)
      .set({
        ...(({ failedLoginAttempts: newAttempts }) as any),
        ...(lockout.lockedUntil ? ({ lockedUntil: lockout.lockedUntil } as any) : {}),
      } as any)
      .where(eq(users.id, user.id))

    if (lockout.locked) {
      throw new AccountLockedError(lockout.lockedUntil)
    }
    throw new InvalidCredentialsError()
  }

  // Check MFA
  const mfaEnabled = await isMFAEnabled(user.id)
  if (mfaEnabled) {
    if (!input.mfaCode) {
      throw new MFARequiredError()
    }
    await verifyMFACode(user.id, input.mfaCode)
  }

  // Reset failed attempts on success
  await db
    .update(users)
    .set({
      lastLoginAt: new Date(),
      ...(({ failedLoginAttempts: 0, lockedUntil: null }) as any),
    } as any)
    .where(eq(users.id, user.id))

  // Get org plan
  let plan: PlanTier = 'free'
  if (user.orgId) {
    const [org] = await db
      .select({ plan: organizations.plan })
      .from(organizations)
      .where(eq(organizations.id, user.orgId))
      .limit(1)
    if (org) plan = org.plan as PlanTier
  }

  // Create tokens and session
  const role = user.role as OrgRole
  const scopes = ['*']
  const tokens = await createTokenPair(user.id, user.orgId!, role, plan, scopes, ctx)
  const session = await createSession(user.id, user.orgId!, tokens.refreshTokenId, plan, ctx)

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      orgId: user.orgId!,
      mfaEnabled,
    },
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    },
    session,
  }
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/** Log out: revoke the session and its refresh token. */
export async function logout(sessionId: string, userId: string): Promise<void> {
  await revokeSession(sessionId, userId)
}

/** Force logout all sessions for a user. */
export async function logoutAll(userId: string): Promise<void> {
  await revokeAllSessions(userId)
}

// ---------------------------------------------------------------------------
// Token Refresh
// ---------------------------------------------------------------------------

/** Refresh an access token using a refresh token. */
export async function refreshTokens(
  rawRefreshToken: string,
  ctx: AuthRequestContext,
): Promise<TokenPair> {
  const result = await rotateRefreshToken(rawRefreshToken, ctx)
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
  }
}

// ---------------------------------------------------------------------------
// Password Reset
// ---------------------------------------------------------------------------

/** Generate a password reset token and return it. */
export async function createPasswordResetToken(email: string): Promise<string | null> {
  const db = getDatabase()

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1)

  if (!user) return null // Don't leak whether email exists

  const token = generateSecureToken(32)
  const tokenHash = sha256(token)

  // Store token hash in Redis with 1-hour expiry
  const { setJSON } = await import('../db/redis')
  await setJSON(`password_reset:${tokenHash}`, { userId: user.id }, 3600)

  return token
}

/** Reset password using a reset token. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  requireStrongPassword(newPassword)

  const tokenHash = sha256(token)

  const { getJSON } = await import('../db/redis')
  const data = await getJSON<{ userId: string }>(`password_reset:${tokenHash}`)

  if (!data) {
    throw new TokenError('expired')
  }

  const db = getDatabase()
  const passwordHash = await hashPassword(newPassword)

  await db
    .update(users)
    .set({
      passwordHash,
      ...(({ passwordChangedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null }) as any),
    } as any)
    .where(eq(users.id, data.userId))

  // Invalidate all sessions and tokens
  await revokeAllSessions(data.userId)

  // Delete the reset token
  const { getRedis } = await import('../db/redis')
  await getRedis().del(`password_reset:${tokenHash}`)
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** List all active sessions for the current user. */
export { listSessions } from './sessions'

// ---------------------------------------------------------------------------
// MFA
// ---------------------------------------------------------------------------

export { setupMFA, verifyMFASetup, disableMFA } from './mfa'


