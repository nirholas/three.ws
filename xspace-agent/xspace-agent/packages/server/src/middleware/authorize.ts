// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Authorization Middleware — RBAC permission checking on Express routes
// =============================================================================
//
// Usage:
//   router.post('/agents', authorize('agents:create'), handler)
//   router.delete('/org', authorize('org:delete'), handler)
//
// Expects `req.tenant` (TenantContext) to be set by upstream tenant
// resolution middleware. Returns 403 with required permission if denied.
// =============================================================================

import type { Request, Response, NextFunction } from 'express'
import {
  hasPermission,
  type Permission,
  type BuiltInRole,
  type TenantContext,
} from 'xspace-agent'

/**
 * Express middleware that checks whether the authenticated user has the
 * required permission. Relies on `req.tenant` being populated
 * by upstream tenant resolution middleware.
 *
 * @param required - The permission scope required (e.g., 'agents:create')
 * @returns Express middleware function
 */
export function authorize(required: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = req.tenant
    if (!ctx) {
      res.status(401).json({
        error: 'Unauthorized',
        hint: 'No tenant context — authenticate first',
      })
      return
    }

    if (!ctx.userRole) {
      res.status(403).json({
        error: 'Forbidden',
        required,
        hint: 'API-key-only requests do not carry a user role. Use a user session.',
      })
      return
    }

    const allowed = hasPermission(required, {
      role: ctx.userRole as BuiltInRole,
      customPermissions: ctx.customPermissions,
    })

    if (!allowed) {
      // Log denial for audit trail (non-blocking)
      logDenied(req, ctx, required)

      res.status(403).json({
        error: 'Forbidden',
        required,
        hint: `Your role '${ctx.userRole}' does not have the '${required}' permission`,
      })
      return
    }

    next()
  }
}

/**
 * Middleware that requires the user to be at least a certain role level.
 * Useful for endpoints that check role hierarchy rather than individual permissions.
 */
export function requireRole(...roles: BuiltInRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = req.tenant
    if (!ctx?.userRole) {
      res.status(401).json({
        error: 'Unauthorized',
        hint: 'No tenant context — authenticate first',
      })
      return
    }

    if (!roles.includes(ctx.userRole as BuiltInRole)) {
      res.status(403).json({
        error: 'Forbidden',
        hint: `This action requires one of: ${roles.join(', ')}`,
      })
      return
    }

    next()
  }
}

/**
 * Middleware that requires the org to be on an Enterprise plan.
 * Used for custom roles, SCIM, and other Enterprise-only features.
 */
export function requireEnterprise() {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = req.tenant
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    if (ctx.plan.tier !== 'enterprise') {
      res.status(403).json({
        error: 'Forbidden',
        hint: 'This feature requires an Enterprise plan',
      })
      return
    }

    next()
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function logDenied(req: Request, ctx: TenantContext, required: Permission): void {
  // Best-effort audit log — fire and forget
  try {
    const detail = {
      method: req.method,
      path: req.path,
      role: ctx.userRole,
      required,
      ip: req.ip,
    }
    // This would normally go to the AuditRepository, but we avoid importing
    // the database layer directly in middleware. The consuming app should
    // hook into a deny event or add an error-logging middleware.
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[authorize] permission denied', JSON.stringify(detail))
    }
  } catch {
    // swallow
  }
}


