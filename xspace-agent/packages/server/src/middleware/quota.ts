// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§89]

// =============================================================================
// Quota Enforcement Middleware — Rate limiting + usage quota checks
// =============================================================================

import type { Request, Response, NextFunction } from 'express'
import type { TenantContext } from 'xspace-agent'
import {
  UsageTracker,
  RATE_LIMITS_BY_PLAN,
  ENDPOINT_GROUP_LIMITS,
} from 'xspace-agent'

// ---------------------------------------------------------------------------
// Augment Express Request with tenant context
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine the endpoint group from the request path. */
function getEndpointGroup(path: string): string | null {
  if (path.startsWith('/agents') || path.startsWith('/admin/agents')) return 'agents'
  if (path.startsWith('/conversations')) return 'conversations'
  if (path.startsWith('/billing') || path.startsWith('/usage')) return 'billing'
  return null
}

/** Calculate the effective rate limit for this request. */
function getEffectiveLimit(planTier: string, path: string): number {
  const orgLimit = RATE_LIMITS_BY_PLAN[planTier] ?? RATE_LIMITS_BY_PLAN.free

  const group = getEndpointGroup(path)
  if (!group) return orgLimit

  const groupLimit = ENDPOINT_GROUP_LIMITS[group]
  if (groupLimit === undefined) return orgLimit

  // Billing endpoints have a flat limit
  if (group === 'billing') return groupLimit

  // Other groups get a percentage of the org limit
  return Math.max(1, Math.floor(orgLimit * groupLimit))
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export interface QuotaMiddlewareConfig {
  /** UsageTracker instance for real-time metering. */
  tracker: UsageTracker
  /** Paths to skip quota enforcement (e.g., /health). */
  skipPaths?: string[]
}

/**
 * Express middleware that enforces:
 * 1. Per-org API rate limits (sliding window)
 * 2. Monthly session-minute quotas
 * 3. Concurrent session limits
 *
 * Requires `req.tenant` to be set by an upstream tenant-resolution middleware.
 *
 * Returns:
 * - 429 with Retry-After header if rate-limited
 * - 402 with upgrade prompt if quota exceeded
 * - Sets X-RateLimit-* headers on all responses
 */
export function createQuotaMiddleware(config: QuotaMiddlewareConfig) {
  const { tracker, skipPaths = ['/health', '/metrics'] } = config

  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip for unauthenticated/health endpoints
    if (skipPaths.includes(req.path)) return next()

    const tenant = req.tenant
    if (!tenant) return next() // No tenant context = no quota enforcement

    const orgId = tenant.orgId
    const planTier = tenant.plan.tier

    // ── 1. Rate limit check ────────────────────────────────
    const limit = getEffectiveLimit(planTier, req.path)
    const rateResult = await tracker.checkRateLimit(orgId, limit)

    // Always set rate limit headers
    res.set('X-RateLimit-Limit', String(limit))
    res.set('X-RateLimit-Remaining', String(rateResult.remaining))
    res.set('X-RateLimit-Reset', String(Math.floor(rateResult.resetAt / 1000)))

    if (!rateResult.allowed) {
      const retryAfterSeconds = Math.ceil((rateResult.resetAt - Date.now()) / 1000)
      res.status(429)
        .set('Retry-After', String(retryAfterSeconds))
        .json({
          error: 'Rate limit exceeded',
          limit,
          remaining: 0,
          retryAfterSeconds,
          hint: `Upgrade your plan for higher rate limits. Current: ${planTier} (${limit} req/min)`,
        })
      return
    }

    // ── 2. Monthly quota check (session minutes) ───────────
    const sessionQuota = await tracker.checkQuota(orgId, planTier, 'session_minutes')
    if (!sessionQuota.allowed) {
      res.status(402).json({
        error: 'Monthly session minute quota exceeded',
        used: sessionQuota.used,
        limit: sessionQuota.limit,
        resetAt: sessionQuota.resetAt.toISOString(),
        hint: 'Upgrade your plan or wait until the next billing period.',
      })
      return
    }

    // ── 3. Track this API call ─────────────────────────────
    // Fire-and-forget — don't block the request
    tracker.trackAPICall(orgId, req.path).catch(() => {})

    next()
  }
}

/**
 * Middleware specifically for session-start endpoints.
 * Checks concurrent session limits before allowing a new session.
 */
export function createSessionQuotaMiddleware(config: QuotaMiddlewareConfig) {
  const { tracker } = config

  return async (req: Request, res: Response, next: NextFunction) => {
    const tenant = req.tenant
    if (!tenant) return next()

    const orgId = tenant.orgId
    const maxConcurrent = tenant.plan.maxConcurrentSessions

    const activeSessions = await tracker.getActiveSessions(orgId)
    if (activeSessions >= maxConcurrent) {
      res.status(429).json({
        error: 'Concurrent session limit reached',
        current: activeSessions,
        limit: maxConcurrent,
        hint: 'Stop an existing session or upgrade your plan to increase the limit.',
      })
      return
    }

    next()
  }
}


