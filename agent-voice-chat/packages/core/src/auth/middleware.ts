// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Enterprise Auth — Middleware
// JWT verification, tenant context injection, rate limiting
// =============================================================================

import { eq } from 'drizzle-orm'
import { verifyAccessToken } from './tokens'
import { TokenError } from './errors'
import { getDatabase } from '../db/connection'
import { users, organizations } from '../db/schema'
import { checkRateLimit } from '../db/redis'
import { runWithTenant, type TenantContext } from '../tenant/context'
import { getPlan } from '../tenant/plans'
import { createFeatureFlags } from '../tenant/feature-flags'
import type { AccessTokenPayload } from './types'
import type { OrgRole, PlanTier, Quotas, Organization, OrgStatus } from '../tenant/types'

// ---------------------------------------------------------------------------
// Authenticated User Context
// ---------------------------------------------------------------------------

/** Authenticated user info attached to the request. */
export interface AuthenticatedUser {
  id: string
  email: string
  orgId: string
  role: OrgRole
  plan: PlanTier
  scopes: string[]
}

// ---------------------------------------------------------------------------
// Token Extraction
// ---------------------------------------------------------------------------

/** Extract bearer token from Authorization header. */
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null
  return parts[1]
}

// ---------------------------------------------------------------------------
// Core Auth Verification (framework-agnostic)
// ---------------------------------------------------------------------------

/** Verify a JWT token and return the decoded payload. */
export function verifyToken(token: string): AccessTokenPayload {
  return verifyAccessToken(token)
}

/** Verify and resolve full user context from a JWT token. */
export async function resolveAuthContext(token: string): Promise<{
  user: AuthenticatedUser
  tenantContext: TenantContext
}> {
  const payload = verifyAccessToken(token)

  const db = getDatabase()

  // Get user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1)

  if (!user) {
    throw new TokenError('invalid')
  }

  // Get organization
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, payload.org))
    .limit(1)

  if (!org) {
    throw new TokenError('invalid')
  }

  const plan = getPlan(org.plan as PlanTier)
  const features = createFeatureFlags(plan.features)

  const quotas: Quotas = {
    maxAgents: plan.maxAgents,
    currentAgents: 0, // Would be loaded from usage tracking
    maxConcurrentSessions: plan.maxConcurrentSessions,
    currentSessions: 0,
    maxSessionMinutesPerMonth: plan.maxSessionMinutesPerMonth,
    usedSessionMinutes: 0,
    maxApiCallsPerMinute: plan.maxApiCallsPerMinute,
  }

  const orgRecord: Organization = {
    id: org.id,
    name: org.name,
    slug: org.slug,
    ownerId: '', // Not tracked in org table currently
    plan: org.plan as PlanTier,
    status: 'active' as OrgStatus,
    createdAt: new Date(org.createdAt!),
    updatedAt: new Date(org.updatedAt!),
  }

  const tenantContext: TenantContext = {
    orgId: org.id,
    userId: user.id,
    plan,
    quotas,
    features,
    org: orgRecord,
  }

  const authenticatedUser: AuthenticatedUser = {
    id: user.id,
    email: user.email,
    orgId: org.id,
    role: user.role as OrgRole,
    plan: org.plan as PlanTier,
    scopes: payload.scopes,
  }

  return { user: authenticatedUser, tenantContext }
}

// ---------------------------------------------------------------------------
// Express Middleware Factories
// ---------------------------------------------------------------------------

/**
 * Express middleware that verifies the JWT access token and injects
 * both `req.user` (AuthenticatedUser) and tenant context into
 * AsyncLocalStorage.
 *
 * Usage:
 * ```typescript
 * import { authMiddleware } from 'xspace-agent/auth'
 * app.use('/api', authMiddleware())
 * ```
 */
export function authMiddleware() {
  return async (req: any, res: any, next: any) => {
    try {
      const token = extractBearerToken(req.headers?.authorization)
      if (!token) {
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Missing or invalid Authorization header',
        })
      }

      const { user, tenantContext } = await resolveAuthContext(token)

      // Attach to request
      req.user = user
      req.tenantContext = tenantContext

      // Run the rest of the middleware chain within tenant context
      runWithTenant(tenantContext, () => next())
    } catch (err: any) {
      if (err instanceof TokenError) {
        return res.status(401).json({
          error: err.code,
          message: err.message,
        })
      }
      next(err)
    }
  }
}

/**
 * Express middleware for API rate limiting based on the plan's API calls/minute.
 */
export function rateLimitMiddleware() {
  return async (req: any, res: any, next: any) => {
    try {
      const user = req.user as AuthenticatedUser | undefined
      if (!user) return next()

      const key = `ratelimit:api:${user.orgId}`
      const tenantCtx = req.tenantContext as TenantContext | undefined
      const limit = tenantCtx?.plan.maxApiCallsPerMinute ?? 100

      const { allowed, remaining } = await checkRateLimit(key, limit, 60)

      res.set('X-RateLimit-Limit', String(limit))
      res.set('X-RateLimit-Remaining', String(remaining))

      if (!allowed) {
        return res.status(429).json({
          error: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded. Maximum ${limit} requests per minute.`,
        })
      }

      next()
    } catch {
      // Don't block requests if rate limiting fails
      next()
    }
  }
}

/**
 * Express middleware to require specific scopes.
 */
export function requireScopes(...requiredScopes: string[]) {
  return (req: any, res: any, next: any) => {
    const user = req.user as AuthenticatedUser | undefined
    if (!user) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      })
    }

    // Wildcard scope grants everything
    if (user.scopes.includes('*')) return next()

    const missing = requiredScopes.filter((s) => !user.scopes.includes(s))
    if (missing.length > 0) {
      return res.status(403).json({
        error: 'INSUFFICIENT_SCOPES',
        message: `Missing required scopes: ${missing.join(', ')}`,
      })
    }

    next()
  }
}

/**
 * Express middleware to require specific roles.
 */
export function requireRole(...allowedRoles: OrgRole[]) {
  return (req: any, res: any, next: any) => {
    const user = req.user as AuthenticatedUser | undefined
    if (!user) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      })
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({
        error: 'INSUFFICIENT_ROLE',
        message: `Required role: ${allowedRoles.join(' or ')}`,
      })
    }

    next()
  }
}


